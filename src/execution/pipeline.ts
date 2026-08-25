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
import { executionPrompts } from "./prompts";
import { type ChangeProposal, changeProposalSchema, executionReviewSchema } from "./schemas";
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
};

/**
 * The default repair instruction warns against expanding scope, which pushes a model that has just
 * refused a task toward refusing it again. When the refusal itself was what got rejected, the
 * instruction has to say the opposite.
 */
function repairInstruction(rejectedBlocker: boolean): string {
  return rejectedBlocker
    ? "Your previous blocker was rejected as factually wrong: the approved scope already covers " +
        "every file you need. Produce the change instead of a blocker."
    : "Correct the proposal once without expanding the approved scope.";
}

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

export async function buildTaskProposal(
  client: ObjectGenerator,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  feedback = "",
  policy: Policy = defaultPolicy,
  graph: Task[] = [task],
  stage: ProposalContext = {},
): Promise<ChangeProposal> {
  const files = stage.files ?? (await readTaskFiles(root, task));
  // Ordered so the part shared by every task of the run — language, spec, constitution, plan —
  // forms one prefix, and only the per-task tail changes. That is what a provider can cache.
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
    files,
    feedback,
  };
  // One loop for both gates: a proposal has to survive deterministic validation and the read-only
  // reviewer, and a rejection from either is what the next draw is told about.
  let previous: ChangeProposal | undefined;
  return sampleUntilValid(
    policy.execution.max_proposal_revisions + 1,
    async (rejection) => {
      const proposal = await generate(
        client,
        rejection === undefined || !previous
          ? context
          : {
              ...context,
              // A rejected blocker's stated reason is wrong by definition, and echoing it back was
              // measured to re-anchor the model on it. Only the refusal itself travels forward.
              rejected_proposal: previous.status === "blocked" ? { status: "blocked" } : previous,
              validation_error: rejection,
              instruction: repairInstruction(previous.status === "blocked"),
            },
      );
      previous = proposal;
      return proposal;
    },
    // Only the deterministic gate runs here. The read-only reviewer used to run on every draw, which
    // put a model's opinion in front of the code ever being executed: a proposal could be refused
    // three times over a judgement call while the commands that would have settled it never ran.
    // It is now the gate on what the loop finally settles, where its findings can be acted on.
    (proposal) => validateProposal(proposal, task, files, policy, graph),
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

async function generate(
  client: ObjectGenerator,
  context: Record<string, unknown>,
): Promise<ChangeProposal> {
  return client.generateObject(
    executionPrompts.implement,
    JSON.stringify(context, null, 2),
    changeProposalSchema,
  );
}
