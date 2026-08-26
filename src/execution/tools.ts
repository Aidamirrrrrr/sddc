import { join } from "node:path";
import { z } from "zod";
import type { Policy } from "../policy/schemas";
import type { RepositoryFile } from "../repository/scan";
import { indexRepository } from "../repository/scan";
import type { Task } from "../tasks/schemas";
import { type ExecutionFile, grantRequestedFiles, sha256 } from "./context";
import { emptyBackup, type FileBackup, writeTracked } from "./files";
import type { ChangeProposal } from "./schemas";
import { searchRepository } from "./search";
import { runCommand } from "./verify";

/**
 * What the implementer may do, one call at a time.
 *
 * The phase used to have a single action — return every declared file, whole — so the only failures
 * it could recover from were the ones expressible as "write those same files differently". A test
 * that failed on a signature in a file the graph had not granted left two moves: guess, or block,
 * and blocking ends the run.
 *
 * The host's contract does not move. Writing is still confined to `files.modify` and
 * `files.create`, and now refused at the moment of the write rather than at the end; commands are
 * still drawn from the policy allowlist; and `finish` produces the ordinary `ChangeProposal`, so
 * every validator, the verification, the reviewer, the journal and the rollback below this file are
 * untouched. What changed is that the model can look before it writes.
 *
 * A flat object with nullable payloads rather than a discriminated union: it matches the shape the
 * rest of these schemas use, and it stays friendly to grammar-constrained decoding, which is the
 * form that will matter again when a smaller model has to speak this protocol.
 */
export const toolCallSchema = z.object({
  /** One line on why this call, so a transcript can be read back by a person. */
  reasoning: z.string(),
  tool: z.enum(["read", "search", "write", "run", "finish", "block"]),
  read: z
    .object({
      reason: z.string(),
      paths: z.array(z.string()).min(1).max(6),
    })
    .nullable(),
  search: z
    .object({
      needle: z.string(),
      glob: z.string(),
    })
    .nullable(),
  write: z.object({ path: z.string(), content: z.string() }).nullable(),
  run: z.object({ program: z.string(), args: z.array(z.string()) }).nullable(),
  finish: z
    .object({
      summary: z.string(),
      traceability: z.array(z.object({ covers: z.string(), paths: z.array(z.string()).min(1) })),
    })
    .nullable(),
  block: z
    .object({
      reason: z.string(),
      required_files: z.array(z.string()),
      required_decision: z.string().nullable(),
    })
    .nullable(),
});

export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolName = ToolCall["tool"];

const PAYLOADS = ["read", "search", "write", "run", "finish", "block"] as const;

/**
 * One call names one tool and carries exactly its payload.
 *
 * Nullable payloads make every other combination expressible, so the combination has to be checked
 * rather than assumed — and the message becomes the next draw's instruction, which is why it says
 * what was wrong rather than only that something was.
 */
export function validateToolCall(call: ToolCall): void {
  const present = PAYLOADS.filter((name) => call[name] !== null);
  if (present.length === 0) {
    throw new Error(`Tool call says "${call.tool}" but carries no ${call.tool} payload.`);
  }
  if (present.length > 1) {
    throw new Error(
      `Tool call carries ${present.join(" and ")} payloads at once. Fill exactly one, the one ` +
        `named by tool, and leave every other null.`,
    );
  }
  if (present[0] !== call.tool) {
    throw new Error(
      `Tool call says "${call.tool}" but carries the ${present[0]} payload. They must agree.`,
    );
  }
}

/** What a call did, for the model to read and for the terminal to show. */
export type ToolResult = {
  tool: ToolName;
  ok: boolean;
  /** One line, kept forever; what an elided transcript entry collapses to. */
  summary: string;
  /** The full text, kept only while the entry is recent. */
  detail: string;
};

export type ToolOutcome =
  | { kind: "continue"; result: ToolResult }
  | { kind: "finish"; proposal: ChangeProposal }
  | { kind: "block"; proposal: ChangeProposal };

export type ToolHostContext = {
  root: string;
  task: Task;
  policy: Policy;
  /**
   * Confirms a command the user did not already approve in the implementation contract.
   *
   * Absent means nothing is asked, which is what trusted mode wants. What counts as "already
   * approved" is decided by `isDeclaredCommand`, not by the model.
   */
  approveCommand?: (program: string, args: string[]) => Promise<boolean>;
};

/**
 * A command the user has already seen and approved.
 *
 * The implementation contract lists every task's verification commands before anything starts, and
 * that guarantee has to survive a model choosing commands at runtime. A declared command's own
 * arguments must be a prefix of what is being run, so `bun test` covers `bun test src/one.test.ts`
 * — narrowing a failing command to find out why is the whole reason the tool exists — while
 * anything that replaces those arguments is a different command and is confirmed.
 */
export function isDeclaredCommand(task: Task, program: string, args: string[]): boolean {
  return task.verification.some(
    (item) =>
      item.command.program === program &&
      item.command.args.every((argument, index) => args[index] === argument),
  );
}

/**
 * Runs tool calls against the workspace, and remembers what it did.
 *
 * Holds the three things a task accumulates: what it wrote, what it may restore to, and what it has
 * been shown. `finish` turns the first of those into the ordinary proposal the rest of the pipeline
 * already knows how to judge.
 */
export function createToolHost(context: ToolHostContext) {
  const { root, task, policy } = context;
  const writable = new Set([...task.files.modify, ...task.files.create]);
  const creatable = new Set(task.files.create);
  const written = new Map<string, string>();
  const backup: FileBackup = emptyBackup();
  const supplied = new Set<string>();
  /** What each file looked like when the model was last shown it. */
  const shown = new Map<string, string>();
  const opened: ExecutionFile[] = [];
  let commandApproval: Promise<boolean> | undefined;
  let index: Promise<RepositoryFile[]> | undefined;

  const ok = (tool: ToolName, summary: string, detail = summary): ToolOutcome => ({
    kind: "continue",
    result: { tool, ok: true, summary, detail },
  });
  const failed = (tool: ToolName, summary: string, detail = summary): ToolOutcome => ({
    kind: "continue",
    result: { tool, ok: false, summary, detail },
  });

  return {
    /** Everything written so far, so an abandoned task restores exactly. */
    backup: (): FileBackup => backup,
    /** Files opened during the loop, added to what the next call is shown. */
    opened: (): ExecutionFile[] => opened,
    /** Marks files the caller supplied up front, so re-reading them is refused as waste. */
    supply(files: ExecutionFile[]): void {
      for (const file of files) {
        supplied.add(file.path);
        shown.set(file.path, file.sha256);
      }
    },

    async execute(call: ToolCall): Promise<ToolOutcome> {
      validateToolCall(call);

      if (call.read) {
        // A file that changed since it was shown is worth reading again. Refusing it as "already
        // supplied" would leave the model unable to recover from the very staleness the write tool
        // had just told it about — the one refusal in here that is meant to be recoverable.
        for (const path of call.read.paths) {
          const seen = shown.get(path);
          if (seen === undefined) continue;
          const file = Bun.file(join(root, path));
          if ((await file.exists()) && sha256(await file.text()) !== seen) supplied.delete(path);
        }
        const grant = await grantRequestedFiles(
          root,
          {
            reason: call.read.reason,
            paths: call.read.paths.map((path) => ({ path, reason: call.read?.reason ?? "" })),
          },
          policy,
          supplied,
        );
        for (const file of grant.granted) {
          supplied.add(file.path);
          shown.set(file.path, file.sha256);
          opened.push(file);
        }
        const names = grant.granted.map((file) => file.path);
        if (names.length === 0) {
          return failed("read", "read: nothing supplied", grant.refusals.join("\n"));
        }
        return ok(
          "read",
          `read ${names.join(", ")}`,
          [`Now in your file list: ${names.join(", ")}`, ...grant.refusals].join("\n"),
        );
      }

      if (call.search) {
        index ??= indexRepository(root);
        const matches = await searchRepository(
          root,
          call.search.needle,
          call.search.glob,
          policy,
          await index,
        );
        if (matches.length === 0) {
          return ok("search", `search "${call.search.needle}": no matches`);
        }
        return ok(
          "search",
          `search "${call.search.needle}": ${matches.length} matches`,
          matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join("\n"),
        );
      }

      if (call.write) {
        const { path, content } = call.write;
        // Refused here rather than at the end. A model that learns its write did not land corrects
        // the next call; one that learns it at `finish` has already built everything on top of it.
        if (!writable.has(path)) {
          return failed(
            "write",
            `write ${path}: outside the approved scope`,
            `${path} is not one of this task's files. You may write only ${[...writable].join(", ")}.`,
          );
        }
        if (Buffer.byteLength(content) > policy.changes.max_generated_file_bytes) {
          return failed(
            "write",
            `write ${path}: too large`,
            `${path} exceeds the size policy allows.`,
          );
        }
        if (!written.has(path)) {
          const file = Bun.file(join(root, path));
          const exists = await file.exists();
          if (creatable.has(path) && exists) {
            return failed(
              "write",
              `write ${path}: already exists`,
              `${path} was listed as a file to create, but it already exists.`,
            );
          }
          // The staleness guard applyProposal used to provide, moved to where the writing now
          // happens. An editor saving mid-task, or a formatter, would otherwise be overwritten
          // silently — and unlike a rejected proposal this is recoverable: read it again.
          const seen = shown.get(path);
          if (exists && seen !== undefined && seen !== sha256(await file.text())) {
            return failed(
              "write",
              `write ${path}: changed since you read it`,
              `${path} has changed on disk since you were shown it. Read it again, then write.`,
            );
          }
        }
        await writeTracked(root, path, content, backup);
        written.set(path, content);
        const lines = content.split("\n").length;
        return ok("write", `wrote ${path} (${lines} lines)`);
      }

      if (call.run) {
        const { program, args } = call.run;
        if (!policy.commands.allowed_programs.includes(program)) {
          return failed(
            "run",
            `run ${program}: not allowed`,
            `${program} is not in this project's allowed programs.`,
          );
        }
        if (context.approveCommand && !isDeclaredCommand(task, program, args)) {
          // Asked once per task, not once per call: a loop that stops to ask on every diagnostic
          // would make strict mode unusable without making it any stricter.
          commandApproval ??= context.approveCommand(program, args);
          if (!(await commandApproval)) {
            return failed("run", `run ${program}: not approved`, "The user declined this command.");
          }
        }
        const outcome = await runCommand(
          root,
          { program, args },
          {
            timeoutMs: policy.execution.command_timeout_seconds * 1_000,
          },
        );
        return {
          kind: "continue",
          result: {
            tool: "run",
            ok: outcome.exit_code === 0,
            summary: `$ ${program} ${args.join(" ")} → exit ${outcome.exit_code}`,
            detail: `$ ${program} ${args.join(" ")}\nexit ${outcome.exit_code}\n${outcome.output}`,
          },
        };
      }

      if (call.finish) {
        return {
          kind: "finish",
          proposal: {
            task_id: task.id,
            status: "ready",
            summary: call.finish.summary,
            blocker: null,
            traceability: call.finish.traceability,
            changes: [...written].map(([path, content]) => ({
              path,
              operation: creatable.has(path) ? ("create" as const) : ("modify" as const),
              // The pre-task state, which is what the validator compares against — not the state
              // after an earlier write in this same loop.
              expected_sha256: creatable.has(path) ? null : (originalHash(backup, path) ?? null),
              content,
            })),
          },
        };
      }

      return {
        kind: "block",
        proposal: {
          task_id: task.id,
          status: "blocked",
          summary: call.block?.reason ?? "Task refused",
          blocker: call.block ?? {
            reason: "Task refused",
            required_files: [],
            required_decision: null,
          },
          traceability: [],
          changes: [],
        },
      };
    },
  };
}

function originalHash(backup: FileBackup, path: string): string | undefined {
  const before = backup.files.get(path);
  return before === null || before === undefined ? undefined : sha256(before);
}
