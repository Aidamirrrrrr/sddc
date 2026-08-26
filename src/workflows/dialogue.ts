import { editText } from "../cli/editor";
import {
  type ArtifactAction,
  type Copy,
  document,
  phrase,
  required,
  reviewDocument,
  warn,
  withSpinner,
} from "../cli/ui";
import type { Policy } from "../policy/schemas";
import { driver } from "../ui/driver";
import { type DialoguePhase, type PhaseState, phaseState, saveSession } from "./session";

/** Every phase artifact answers these two questions the same way. */
export type Clarifiable = {
  status: string;
  questions: Array<{ id: string; question: string; reason: string }>;
};

export type ConvergeOptions<T extends Clarifiable> = {
  phase: DialoguePhase;
  root: string;
  request: string;
  policy: Policy;
  initial: PhaseState;
  /** Builds the artifact from the accumulated clarifications and review feedback. */
  build: (input: string) => Promise<T>;
  progress: Copy;
  complete: Copy;
  title: Copy;
  reviewPrompt: Copy;
  revisePrompt: Copy;
  summary: (value: T) => string;
  details: (value: T) => string;
  /** Serialized form of a rejected artifact, fed back so the next attempt can see what was wrong. */
  render: (value: T) => string;
  clarificationHeading: string;
  rejectionHeading: string;
  /** Lets a phase stop on a terminal status it handles itself, such as decomposition. */
  settled?: (value: T) => boolean;
  /**
   * Reads an edited artifact back. Supplying it enables direct editing; a phase that cannot safely
   * round-trip its artifact simply omits it and the action is not offered.
   */
  parse?: (text: string) => T;
};

/**
 * Drives one phase to an approved artifact.
 *
 * Replaces three hand-written `while (true)` loops, and in doing so gives all of them the two things
 * none of them had: a bound on how long the model may keep asking, and a durable record of what the
 * user already answered.
 */
export async function converge<T extends Clarifiable>(options: ConvergeOptions<T>): Promise<T> {
  const { policy, phase, root, request } = options;
  const state: PhaseState = { ...options.initial };

  const persist = async (): Promise<void> => saveSession(root, request, phase, state);

  while (true) {
    let value = await withSpinner(options.progress, options.complete, () =>
      options.build(state.input),
    );

    if (value.status === "needs_clarification") {
      if (state.clarification_rounds >= policy.dialogue.max_clarification_rounds) {
        throw new Error(
          `Phase ${phase} still needs clarification after ${state.clarification_rounds} rounds`,
        );
      }
      state.clarification_rounds += 1;
      state.input += `\n\n${options.clarificationHeading}\n`;
      for (const question of value.questions) {
        document(
          { en: `Decision needed · ${question.id}`, ru: `Нужно решение · ${question.id}` },
          `${question.question}\n\n${question.reason}`,
        );
        const answer = await required({ en: "Your answer", ru: "Ваш ответ" });
        state.input += `${question.id}: ${answer}\n`;
        // Persist per answer: the next stage is the one that may fail, and it must not take the
        // answer down with it.
        await persist();
      }
      continue;
    }

    if (options.settled?.(value)) return value;

    if (await autoAccepted(options, value, state)) return value;

    // The review menu stays open until the user either accepts or asks for another build; editing
    // and inspecting decisions change nothing upstream, so neither spends a revision round.
    let decision = await review(options, value);
    while (decision === "edit" || decision === "decisions") {
      if (decision === "decisions") showDecisions(state.input);
      else value = (await edit(options, value)) ?? value;
      decision = await review(options, value);
    }
    if (decision === "accept") return value;

    if (state.revision_rounds >= policy.dialogue.max_revision_rounds) {
      throw new Error(`Phase ${phase} was revised ${state.revision_rounds} times without approval`);
    }
    state.revision_rounds += 1;
    const feedback = await required(options.revisePrompt);
    state.input += `\n\n${options.rejectionHeading}\n${options.render(value)}\n\nUser review feedback:\n${feedback}\n`;
    await persist();
  }
}

async function review<T extends Clarifiable>(
  options: ConvergeOptions<T>,
  value: T,
): Promise<ArtifactAction> {
  const action = await reviewDocument(
    options.reviewPrompt,
    options.title,
    options.summary(value),
    options.details(value),
  );
  // Offering an edit the phase cannot read back would lose the user's work silently.
  if (action === "edit" && !options.parse) {
    warn({
      en: "This artifact cannot be edited directly",
      ru: "Этот артефакт нельзя отредактировать напрямую",
    });
    return review(options, value);
  }
  return action;
}

/** Returns the edited artifact, or nothing when the edit was abandoned or rejected. */
async function edit<T extends Clarifiable>(
  options: ConvergeOptions<T>,
  value: T,
): Promise<T | undefined> {
  const parse = options.parse;
  if (!parse) return undefined;
  try {
    return parse(await editText(options.render(value)));
  } catch (error) {
    // A rejected edit leaves the previous artifact standing rather than dropping the run.
    warn({
      en: `Edit rejected: ${errorText(error)}`,
      ru: `Правка отклонена: ${errorText(error)}`,
    });
    return undefined;
  }
}

function showDecisions(input: string): void {
  document(
    { en: "Decisions so far", ru: "Принятые решения" },
    input.trim() || "Nothing has been decided in this phase yet.",
  );
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export { phaseState };

/**
 * Whether this artifact is one nobody had to decide anything about.
 *
 * Everything that reaches the review menu has already passed every validator — sampling would not
 * have returned otherwise — so "it is valid" is not a signal, and treating it as one would delete
 * the review rather than shorten it.
 *
 * The signal is that the phase never had to ask a question and was never sent back for another
 * version. Then the accept keystroke carries no information: the user is agreeing with something
 * they were never in tension with. The artifact is still shown, still lands in the transcript, and
 * is still stoppable — only the demand for a keystroke goes away.
 *
 * A surface that cannot read a key without a prompt open does not offer this, and falls through to
 * asking properly.
 */
async function autoAccepted<T extends Clarifiable>(
  options: ConvergeOptions<T>,
  value: T,
  state: PhaseState,
): Promise<boolean> {
  const seconds = options.policy.dialogue.auto_accept_seconds;
  if (seconds <= 0) return false;
  if (value.status !== "ready" || value.questions.length > 0) return false;
  if (state.clarification_rounds > 0 || state.revision_rounds > 0) return false;
  const countdown = driver().autoAccept;
  if (!countdown) return false;
  document(options.title, options.summary(value));
  return countdown.call(driver(), phrase(options.reviewPrompt), seconds);
}
