import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel, Output } from "ai";
import type { z } from "zod";
import type { ModelConfig } from "../config/env";
import { withBackoff } from "./backoff";
import { chargeCall } from "./budget";
import { interruptSignal, throwIfInterrupted } from "./interrupt";
import { withOneRepair } from "./repair";
import { recordUsage } from "./usage";

/**
 * Held constant across every stage so it can never be the reason a cached prefix misses. The stage's
 * own instruction travels at the end of the user message instead.
 */
export const PREAMBLE =
  "You are one stage of a specification-driven development pipeline. " +
  "The context comes first and the instruction for this stage comes last. " +
  "Follow that instruction exactly and return only the structured output its schema defines.";

const INSTRUCTION_SEPARATOR = "\n\n----- stage instruction -----\n\n";

/**
 * Places the stage instruction after the context.
 *
 * Within a phase each stage appends its predecessor's output to the same context object, so
 * everything up to that appendix repeats verbatim. Keeping the instruction out of the prefix is what
 * lets a provider with automatic prefix caching charge for the repeated part once.
 */
export function composePrompt(instruction: string, context: string): string {
  return `${context}${INSTRUCTION_SEPARATOR}${instruction}`;
}

export class ModelClient {
  private readonly model: LanguageModel;
  private readonly thinking: boolean;
  private readonly maxOutputTokens: number | undefined;
  private readonly requestTimeoutMs: number;

  constructor(config: ModelConfig, thinking: boolean) {
    const provider = createOpenAICompatible({
      name: "modelApi",
      baseURL: config.apiUrl,
      apiKey: config.apiToken,
      supportsStructuredOutputs: true,
    });
    this.model = provider.chatModel(config.model);
    this.thinking = thinking;
    this.maxOutputTokens = config.maxOutputTokens;
    this.requestTimeoutMs = config.requestTimeoutMs;
  }

  /** `instruction` identifies the stage; `context` is the accumulated pipeline state. */
  async generateObject<T>(instruction: string, context: string, schema: z.ZodType<T>): Promise<T> {
    // Charged once per stage call rather than per HTTP attempt: transport retries are the provider
    // failing, not the run asking for more work, and charging them would let a flaky link eat a
    // budget that exists to bound the pipeline's own appetite.
    throwIfInterrupted();
    chargeCall();
    return withOneRepair(
      composePrompt(instruction, context),
      async (currentPrompt, { degraded }) => {
        // Two different failures, two different answers: transport trouble is retried verbatim
        // here, while a malformed response goes back out to withOneRepair with the error attached.
        const result = await withBackoff(() =>
          generateText({
            model: this.model,
            system: PREAMBLE,
            prompt: currentPrompt,
            temperature: 0,
            // Two ways a request ends without an answer: somebody stops it, or it goes quiet. The
            // first must not be retried and the second must be, so they stay distinguishable.
            abortSignal: AbortSignal.any([
              interruptSignal(),
              AbortSignal.timeout(this.requestTimeoutMs),
            ]),
            // Omitted entirely when unset, so the model's own maximum applies rather than ours.
            ...(this.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: this.maxOutputTokens }),
            maxRetries: 0,
            output: Output.object({
              name: "stage_output",
              schema,
            }),
            providerOptions: {
              modelApi: {
                strictJsonSchema: true,
                ...(this.thinking && !degraded ? { reasoningEffort: "high" } : {}),
              },
            },
          }),
        );
        recordUsage(result.usage);
        return result.output;
      },
    );
  }
}
