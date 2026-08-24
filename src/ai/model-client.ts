import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel, Output } from "ai";
import type { z } from "zod";
import type { ModelConfig } from "../config/env";
import { withOneRepair } from "./repair";

export class ModelClient {
  private readonly model: LanguageModel;
  private readonly thinking: boolean;

  constructor(config: ModelConfig, thinking: boolean) {
    const provider = createOpenAICompatible({
      name: "modelApi",
      baseURL: config.apiUrl,
      apiKey: config.apiToken,
      supportsStructuredOutputs: true,
    });
    this.model = provider.chatModel(config.model);
    this.thinking = thinking;
  }

  async generateObject<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
    return withOneRepair(prompt, async (currentPrompt) => {
      const result = await generateText({
        model: this.model,
        system,
        prompt: currentPrompt,
        temperature: 0,
        maxOutputTokens: this.thinking ? 4096 : 2048,
        maxRetries: 0,
        output: Output.object({
          name: "stage_output",
          schema,
        }),
        providerOptions: {
          modelApi: {
            strictJsonSchema: true,
            ...(this.thinking ? { reasoningEffort: "high" } : {}),
          },
        },
      });
      return result.output;
    });
  }
}
