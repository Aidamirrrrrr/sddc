import type { ModelClient } from "../ai/model-client";
import { intentPrompt } from "./prompts";
import { type RequestIntent, requestIntentSchema } from "./schemas";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

export function classifyRequest(client: ObjectGenerator, request: string): Promise<RequestIntent> {
  return client.generateObject(intentPrompt, request, requestIntentSchema);
}
