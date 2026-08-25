import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * Answers the user typed are expensive: they are decisions no artifact records until the phase
 * finishes. Persisting them per phase means a failed stage costs a retry, not the conversation.
 *
 * The file lives under `.specs`, which policy already forbids the model from reading or writing.
 */
export const dialoguePhases = ["spec", "plan", "tasks"] as const;
export type DialoguePhase = (typeof dialoguePhases)[number];

const phaseStateSchema = z.object({
  /** Clarification answers and review feedback accumulated for this phase, in prompt order. */
  input: z.string(),
  clarification_rounds: z.number().int().nonnegative(),
  revision_rounds: z.number().int().nonnegative(),
});

export const sessionSchema = z.object({
  version: z.literal(1),
  request: z.string(),
  updated_at: z.string(),
  spec: phaseStateSchema.optional(),
  plan: phaseStateSchema.optional(),
  tasks: phaseStateSchema.optional(),
});

export type PhaseState = z.infer<typeof phaseStateSchema>;
export type Session = z.infer<typeof sessionSchema>;

const EMPTY: PhaseState = { input: "", clarification_rounds: 0, revision_rounds: 0 };

export function sessionPath(root: string): string {
  return join(root, ".specs", "session.yaml");
}

/**
 * Returns the stored session only when it belongs to the same request; a different request is a
 * different conversation, and replaying its answers would silently corrupt the new one.
 */
export async function loadSession(root: string, request: string): Promise<Session | undefined> {
  const file = Bun.file(sessionPath(root));
  if (!(await file.exists())) return undefined;
  try {
    const session = sessionSchema.parse(Bun.YAML.parse(await file.text()));
    return session.request === request ? session : undefined;
  } catch {
    // A malformed session is recoverable state, not a reason to refuse the run.
    return undefined;
  }
}

export function phaseState(session: Session | undefined, phase: DialoguePhase): PhaseState {
  return session?.[phase] ?? { ...EMPTY };
}

export function hasRecordedAnswers(session: Session | undefined): boolean {
  return dialoguePhases.some((phase) => phaseState(session, phase).input.trim().length > 0);
}

export async function saveSession(
  root: string,
  request: string,
  phase: DialoguePhase,
  state: PhaseState,
): Promise<void> {
  const existing = await loadSession(root, request);
  const session: Session = {
    version: 1,
    request,
    updated_at: new Date().toISOString(),
    spec: existing?.spec,
    plan: existing?.plan,
    tasks: existing?.tasks,
    [phase]: state,
  };
  const path = sessionPath(root);
  await mkdir(join(root, ".specs"), { recursive: true });
  await Bun.write(path, Bun.YAML.stringify(session, null, 2));
}

/** Called once a feature is fully delivered, so the next run starts from a clean conversation. */
export async function clearSession(root: string): Promise<void> {
  await Bun.file(sessionPath(root))
    .delete()
    .catch(() => undefined);
}
