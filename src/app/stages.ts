import type { ModelClient } from "../ai/model-client";
import { runExecutionStage } from "../execution/pipeline";
import { runPlanningStage } from "../planning/pipeline";
import { runRepositoryStage } from "../repository/pipeline";
import { runStage as runSpecificationStage } from "../spec/pipeline";

export async function runDiagnosticStage(
  client: ModelClient,
  stage: string,
  input: string,
): Promise<unknown> {
  if (stage.startsWith("repository-")) return runRepositoryStage(client, stage, input);
  if (stage.startsWith("planning-")) return runPlanningStage(client, stage, input);
  if (stage.startsWith("execution-")) return runExecutionStage(client, stage, input);
  return runSpecificationStage(client, stage, input);
}
