import { type Copy, document, required, reviewDocument, withSpinner } from "../cli/ui";
import type { Policy } from "../policy/schemas";
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
    const value = await withSpinner(options.progress, options.complete, () =>
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

    const decision = await reviewDocument(
      options.reviewPrompt,
      options.title,
      options.summary(value),
      options.details(value),
    );
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

export { phaseState };
