import { type DialoguePhase, type PhaseState, phaseState, type Session } from "./session";

/**
 * Identifies the conversation a phase belongs to, so recorded answers are replayed only into the
 * run that produced them.
 */
export type DialogueContext = {
  root: string;
  /** Stable identity of this conversation: the original request, or the recompiled feature. */
  request: string;
  session: Session | undefined;
};

export function initialState(context: DialogueContext, phase: DialoguePhase): PhaseState {
  return phaseState(context.session, phase);
}

export function recompileContext(root: string, feature: string): DialogueContext {
  return { root, request: `recompile:${feature}`, session: undefined };
}
