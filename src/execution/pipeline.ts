import type { ModelClient } from "../ai/model-client";
import { sampleUntilValid } from "../ai/sample";
import type { ImplementationPlan } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import { writesOnlyTests } from "../policy/paths";
import type { Policy } from "../policy/schemas";
import { specificationLanguage } from "../spec/language";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { type ExecutionFile, readTaskFiles } from "./context";
import type { FileBackup } from "./files";
import { executionPrompts } from "./prompts";
import { type ChangeProposal, changeProposalSchema, executionReviewSchema } from "./schemas";
import { createToolHost, type ToolResult, toolCallSchema, validateToolCall } from "./tools";
import { validateProposal } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

/**
 * What the earlier phases decided, carried into the one that writes code.
 *
 * Everything here was established upstream and used to stop at the task graph: the constitution the
 * plan was held to, the answers the user typed during clarification, which siblings have actually
 * landed. A phase that cannot see the decisions it is implementing re-derives them, and re-deriving
 * a decision is how an execution phase introduces the architecture nobody asked for.
 */
export type ProposalContext = {
  constitution?: string;
  /** Answers the user gave in the dialogue phases; no artifact records them verbatim. */
  clarifications?: string;
  /** Task ids whose changes are already on disk, so the outline can say what is real. */
  completed?: Iterable<string>;
  /** Files the caller already read, so one attempt works from exactly one snapshot. */
  files?: ExecutionFile[];
  /**
   * Whether a task already completed in this run left the suite red on purpose.
   *
   * Host-only: it never reaches a prompt. Under test-first the test task lands first and is judged
   * by failing, and from that moment every other task shares a workspace whose suite is red by
   * design. Without this the exemption for an inherited failure would have to apply always, which
   * would excuse a task whose verification simply never passes.
   */
  suiteRedByDesign?: boolean;
  /**
   * Confirms a command the user has not already approved in the implementation contract.
   *
   * A callback among facts, which is not tidy — but the alternative was a tenth positional
   * parameter on a function that already had nine, and the loop is the only thing that needs it.
   */
  approveCommand?: (program: string, args: string[]) => Promise<boolean>;
  /** Lets the terminal show a task working rather than a task thinking. */
  onToolResult?: (result: { tool: string; ok: boolean; summary: string }) => void;
};

/**
 * What the rest of the graph is doing, read-only.
 *
 * Without this a task sees only itself and reasons as though it were the whole change, so it blocks
 * whenever its own slice leaves the code incoherent — refusing to add a type because the function
 * using it does not exist yet, when a sibling task is about to add exactly that. Permissions are
 * unaffected: writing is still governed solely by the task's own files.
 */
function graphOutline(graph: Task[], current: Task, completed: Set<string>) {
  return graph
    .filter((task) => task.id !== current.id)
    .map((task) => ({
      id: task.id,
      title: task.title,
      wave: task.wave,
      depends_on: task.depends_on,
      writes: [...task.files.modify, ...task.files.create],
      covers: [...task.requirements, ...task.acceptance],
      // "Missing" and "not written yet" call for opposite reactions, and the outline was silent
      // about which one a sibling is in.
      status: completed.has(task.id) ? "applied" : "pending",
    }));
}

/**
 * The verification outcome the host will accept, stated by the host.
 *
 * Under test-first a task that writes only tests is judged red, not green. Leaving that to the
 * prompt meant the executor was told to satisfy verification while the runner was waiting for the
 * opposite, and it learned the truth only by failing once. It is derived from the task's own files,
 * so it cannot be talked out of.
 */
function verificationExpectation(task: Task, policy: Policy): string {
  if (policy.changes.require_test_before_implementation && writesOnlyTests(task.files)) {
    return (
      "This task writes only tests, and the implementation it covers does not exist yet. Its " +
      "verification command is REQUIRED TO FAIL: write a test that asserts the required behaviour " +
      "and therefore fails now. A test that passes today asserts nothing and will be rejected. " +
      "The functions, fields and signatures the test calls may not exist yet — reference them " +
      "anyway, exactly as they will be once implemented. That is what makes the test fail today, " +
      "and it is the whole point: a pending sibling task adds them. Do not stub them, do not skip " +
      "the test, do not weaken the assertion so it passes, and never take over the implementation " +
      "file to make the reference resolve. The only wrong failure is a test file so malformed the " +
      "suite cannot start."
    );
  }
  return "Verification commands must pass once this task's changes are applied.";
}

/**
 * What one attempt at a task produced.
 *
 * The backup travels with the proposal now: the loop writes as it goes, so by the time there is
 * something to judge the workspace has already moved, and whoever decides to keep or abandon the
 * result needs the means to undo it in the same hand.
 */
export type TaskAttempt = {
  proposal: ChangeProposal;
  /** Everything the model ended up seeing, including files it opened during the loop. */
  files: ExecutionFile[];
  backup: FileBackup;
};

/**
 * Drives one task's tool loop until it finishes, refuses, or runs out of calls.
 *
 * Every call is one structured output, validated before the host acts on it, and the host's answer
 * goes back as the next call's evidence. `finish` produces the ordinary `ChangeProposal`, so
 * everything downstream — the validator, the verification, the reviewer, the journal, the rollback —
 * judges this exactly as it judged a single-shot proposal.
 *
 * A rejected `finish` is not the end of the attempt. `validateProposal`'s messages are written as
 * instructions for whoever reads them next, so the rejection becomes a tool result and the loop
 * gets to correct it — which is what a one-shot draw could never do.
 */
export async function runTaskTools(
  client: ObjectGenerator,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  feedback = "",
  policy: Policy = defaultPolicy,
  graph: Task[] = [task],
  stage: ProposalContext = {},
): Promise<TaskAttempt> {
  const opening = stage.files ?? (await readTaskFiles(root, task));
  const tools = createToolHost({
    root,
    task,
    policy,
    ...(stage.approveCommand ? { approveCommand: stage.approveCommand } : {}),
  });
  tools.supply(opening);

  // Ordered so the part shared by every task of the run — language, spec, constitution, plan —
  // forms one prefix, and only the per-task tail changes. That is what a provider can cache, and
  // it is why the transcript, which grows on every call, sits at the very end.
  const context = {
    outputLanguage: specificationLanguage(spec),
    specification: spec,
    constitution: stage.constitution || undefined,
    // The whole accepted plan, not a one-line summary of it. The decisions, contracts and data
    // model are the thing phases 3 and 4 exist to fix; withholding them made every task re-decide.
    plan: {
      summary: plan.summary,
      decisions: plan.decisions,
      approach: plan.approach,
      contracts: plan.contracts,
      data_model: plan.data_model,
    },
    userDecisions: stage.clarifications || undefined,
    task,
    expectation: verificationExpectation(task, policy),
    otherTasks: graphOutline(graph, task, new Set(stage.completed ?? [])),
    feedback,
  };

  const transcript: ToolResult[] = [];
  const calls = Math.max(1, policy.execution.max_tool_calls_per_task);
  let lastRejection: string | undefined;

  for (let step = 1; step <= calls; step += 1) {
    const files = [...opening, ...tools.opened()];
    const call = await sampleUntilValid(
      policy.execution.max_proposal_revisions + 1,
      async (rejection) =>
        client.generateObject(
          executionPrompts.implement,
          pretty({
            ...context,
            files,
            remaining_calls: calls - step + 1,
            transcript: summarize(transcript, policy.execution.max_transcript_results),
            ...(rejection === undefined ? {} : { call_error: rejection }),
          }),
          toolCallSchema,
        ),
      (candidate) => validateToolCall(candidate),
    );

    const outcome = await tools.execute(call);
    if (outcome.kind === "continue") {
      transcript.push({ ...outcome.result, summary: `${step}. ${outcome.result.summary}` });
      stage.onToolResult?.(outcome.result);
      continue;
    }

    try {
      validateProposal(outcome.proposal, task, files, policy, graph);
      return { proposal: outcome.proposal, files, backup: tools.backup() };
    } catch (error) {
      // Not the end of the attempt: the validator's message is written to be acted on, so it goes
      // back as evidence and the loop corrects it. A one-shot draw could only be redrawn whole.
      lastRejection = error instanceof Error ? error.message : String(error);
      transcript.push({
        tool: outcome.proposal.status === "blocked" ? "block" : "finish",
        ok: false,
        summary: `${step}. rejected: ${lastRejection.slice(0, 120)}`,
        detail: lastRejection,
      });
    }
  }

  throw new Error(
    `Task ${task.id} used all ${calls} tool calls without a usable result` +
      (lastRejection ? `. Last rejection: ${lastRejection}` : "."),
  );
}

/**
 * The transcript the next call is shown.
 *
 * It grows on every call, and a task that reads four files and runs three commands would otherwise
 * carry every byte of all seven forever. The recent entries keep their full text because that is
 * what is being reasoned about; everything older collapses to the line it was summarised as, which
 * is enough to remember that it happened and what came of it.
 */
export function summarize(results: ToolResult[], keep: number): unknown[] {
  const full = Math.max(0, keep);
  return results.map((result, index) =>
    index >= results.length - full
      ? { tool: result.tool, ok: result.ok, output: result.detail }
      : { tool: result.tool, ok: result.ok, output: result.summary },
  );
}

/** The context the read-only reviewer needs, assembled from the same material the implementer saw. */
export function reviewContextFor(
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  policy: Policy,
  graph: Task[],
  stage: ProposalContext,
) {
  return {
    spec,
    task,
    plan: {
      summary: plan.summary,
      decisions: plan.decisions,
      approach: plan.approach,
      contracts: plan.contracts,
      data_model: plan.data_model,
    },
    constitution: stage.constitution || undefined,
    outputLanguage: specificationLanguage(spec),
    expectation: verificationExpectation(task, policy),
    otherTasks: graphOutline(graph, task, new Set(stage.completed ?? [])),
  };
}

export async function runExecutionStage(
  client: ObjectGenerator,
  stageName: string,
  input: string,
): Promise<unknown> {
  if (stageName === "execution-implement") {
    return client.generateObject(executionPrompts.implement, input, changeProposalSchema);
  }
  if (stageName === "execution-review") {
    return client.generateObject(executionPrompts.review, input, executionReviewSchema);
  }
  return undefined;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
