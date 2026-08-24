import type { z } from "zod";
import type { ModelClient } from "../ai/model-client";
import { normalizeSpec } from "./normalize";
import { prompts } from "./prompts";
import {
  type Ambiguity,
  type AmbiguityFilter,
  ambiguityFilterSchema,
  ambiguitySchema,
  clarificationSchema,
  extractionSchema,
  reviewSchema,
  type Spec,
  scopeSchema,
  specSchema,
} from "./schemas";
import { validateReview, validateSpec } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

export async function buildSpec(client: ObjectGenerator, request: string): Promise<Spec> {
  const extraction = await client.generateObject(prompts.extract, request, extractionSchema);
  const context = { request, outputLanguage: extraction.language, extraction };
  const completeness = await client.generateObject(
    prompts.clarification,
    pretty(context),
    clarificationSchema,
  );
  if (extraction.facts.length <= 1 || completeness.decision === "needs_clarification") {
    if (completeness.questions.length === 0) {
      throw new Error("Completeness gate requested clarification without questions");
    }
    return buildClarificationSpec(extraction, completeness);
  }
  const proposedAmbiguity = await client.generateObject(
    prompts.ambiguity,
    pretty(context),
    ambiguitySchema,
  );
  const filter = await client.generateObject(
    prompts.questionReview,
    pretty({ ...context, proposedAnalysis: proposedAmbiguity }),
    ambiguityFilterSchema,
  );
  const ambiguity = filterAmbiguity(proposedAmbiguity, filter);
  const proposedScope = await client.generateObject(prompts.scope, pretty(context), scopeSchema);
  const scope = await client.generateObject(
    prompts.scopeReview,
    pretty({ ...context, proposedScope }),
    scopeSchema,
  );
  const candidate = await client.generateObject(
    prompts.writer,
    pretty({ ...context, ambiguityAnalysis: ambiguity, scopeAnalysis: scope }),
    specSchema,
  );
  const review = await client.generateObject(
    prompts.reviewer,
    pretty({ ...context, candidate }),
    reviewSchema,
  );
  const spec = normalizeSpec(review.spec);
  validateReview(review.checks);
  validateSpec(spec);
  return spec;
}

export async function runStage(
  client: ObjectGenerator,
  stage: string,
  input: string,
): Promise<unknown> {
  const definitions = {
    extract: [prompts.extract, extractionSchema],
    clarification: [prompts.clarification, clarificationSchema],
    ambiguity: [prompts.ambiguity, ambiguitySchema],
    "question-review": [prompts.questionReview, ambiguityFilterSchema],
    scope: [prompts.scope, scopeSchema],
    "scope-review": [prompts.scopeReview, scopeSchema],
    write: [prompts.writer, specSchema],
    review: [prompts.reviewer, reviewSchema],
  } as const;
  const definition = definitions[stage as keyof typeof definitions];
  if (!definition) throw new Error(`Unknown stage "${stage}"`);
  return client.generateObject(definition[0], input, definition[1] as z.ZodType<unknown>);
}

function buildClarificationSpec(
  extraction: z.infer<typeof extractionSchema>,
  clarification: z.infer<typeof clarificationSchema>,
): Spec {
  return {
    status: "needs_clarification",
    feature: extraction.feature,
    goal: extraction.goal,
    requirements: extraction.facts.map((fact, index) => ({
      id: `R${index + 1}`,
      statement: fact.statement,
    })),
    acceptance: [],
    issues: [],
    questions: clarification.questions.map((item, index) => ({
      id: `Q${index + 1}`,
      question: item.question,
      reason: item.reason,
      blocking: true,
    })),
    subfeatures: [],
  };
}

function filterAmbiguity(ambiguity: Ambiguity, filter: AmbiguityFilter): Ambiguity {
  const issues = new Set(filter.kept_issue_ids);
  const questions = new Set(filter.kept_question_ids.slice(0, 3));
  return {
    issues: ambiguity.issues.filter((item) => issues.has(item.id)),
    questions: ambiguity.questions.filter((item) => questions.has(item.id)).slice(0, 3),
  };
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
