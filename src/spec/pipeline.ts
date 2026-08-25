import type { z } from "zod";
import type { ModelClient } from "../ai/model-client";
import { sampleUntilValid } from "../ai/sample";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { RequestRepositoryContext } from "../repository/request-context";
import { normalizeSpec } from "./normalize";
import { prompts } from "./prompts";
import {
  analysisSchema,
  type Extraction,
  extractionSchema,
  reviewSchema,
  type Spec,
  specSchema,
} from "./schemas";
import { normalizeClarificationQuestions, validateReview, validateSpec } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;
type Analysis = z.infer<typeof analysisSchema>;

export async function buildSpec(
  client: ObjectGenerator,
  request: string,
  repository?: RequestRepositoryContext,
  policy: Policy = defaultPolicy,
  constitution = "",
): Promise<Spec> {
  const extraction = await client.generateObject(prompts.extract, request, extractionSchema);
  const context = {
    request,
    outputLanguage: extraction.language,
    constitution: constitution || undefined,
    extraction,
    repositoryContext: repository
      ? { userContext: repository.userContext || undefined, snapshots: repository.snapshots }
      : undefined,
  };
  const proposedAnalysis = await client.generateObject(
    prompts.analyze,
    pretty(context),
    analysisSchema,
  );
  const reviewedAnalysis = await client.generateObject(
    prompts.analysisReview,
    pretty({ ...context, proposedAnalysis }),
    analysisSchema,
  );
  let analysis = conservativeAnalysis(proposedAnalysis, reviewedAnalysis, repository !== undefined);
  let error = analysisError(extraction, analysis);
  if (error !== null) {
    analysis = await client.generateObject(
      prompts.analysisRepair,
      pretty({ ...context, rejectedAnalysis: analysis, validationError: error }),
      analysisSchema,
    );
    error = analysisError(extraction, analysis);
    if (error !== null) throw new Error(`Invalid product analysis after repair: ${error}`);
  }

  if (analysis.decision === "needs_decomposition") {
    return buildDecompositionSpec(extraction, analysis);
  }
  if (analysis.decision === "needs_clarification") {
    const questions = normalizeClarificationQuestions(analysis.questions);
    return buildClarificationSpec(extraction, { ...analysis, questions });
  }

  // The first phase was the only one without rejection sampling: a single unusable draw from the
  // writer ended the run outright, in the phase where the user has invested the least and would have
  // to start over. The verifier here is free and deterministic like every other one.
  return sampleUntilValid(
    policy.sampling.max_attempts,
    async (rejection) => {
      const attemptContext =
        rejection === undefined ? context : { ...context, validationError: rejection };
      const candidate = await client.generateObject(
        prompts.writer,
        pretty(attemptContext),
        specSchema,
      );
      const review = await client.generateObject(
        prompts.reviewer,
        pretty({ ...attemptContext, candidate }),
        reviewSchema,
      );
      return {
        review,
        spec: normalizeSpec({
          ...review.spec,
          feature: extraction.feature,
          goal: extraction.goal,
          status: "ready",
          issues: [],
          questions: [],
          subfeatures: [],
        }),
      };
    },
    ({ review, spec }) => {
      validateReview(review.checks);
      validateSpec(spec);
    },
  ).then(({ spec }) => spec);
}

export async function runStage(
  client: ObjectGenerator,
  stage: string,
  input: string,
): Promise<unknown> {
  const definitions = {
    extract: [prompts.extract, extractionSchema],
    analyze: [prompts.analyze, analysisSchema],
    "analysis-review": [prompts.analysisReview, analysisSchema],
    "analysis-repair": [prompts.analysisRepair, analysisSchema],
    write: [prompts.writer, specSchema],
    review: [prompts.reviewer, reviewSchema],
  } as const;
  const definition = definitions[stage as keyof typeof definitions];
  if (!definition) throw new Error(`Unknown stage "${stage}"`);
  return client.generateObject(definition[0], input, definition[1] as z.ZodType<unknown>);
}

function buildDecompositionSpec(extraction: Extraction, analysis: Analysis): Spec {
  const spec = normalizeSpec({
    status: "needs_decomposition",
    feature: extraction.feature,
    goal: extraction.goal,
    requirements: extraction.facts.map((fact) => ({ id: fact.id, statement: fact.statement })),
    acceptance: [],
    issues: [],
    questions: [],
    subfeatures: analysis.subfeatures,
  });
  validateSpec(spec);
  return spec;
}

function buildClarificationSpec(extraction: Extraction, analysis: Analysis): Spec {
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
    questions: analysis.questions.map((item, index) => ({
      id: `Q${index + 1}`,
      question: item.question,
      reason: item.reason,
      blocking: true,
    })),
    subfeatures: [],
  };
}

function analysisError(extraction: Extraction, analysis: Analysis): string | null {
  if (analysis.decision === "ready") {
    if (analysis.questions.length > 0 || analysis.subfeatures.length > 0) {
      return "Ready analysis must not contain questions or subfeatures.";
    }
    return null;
  }
  if (analysis.decision === "needs_clarification") {
    if (analysis.questions.length === 0) return "Clarification requires at least one question.";
    if (analysis.subfeatures.length > 0) return "Clarification must not contain subfeatures.";
    return null;
  }
  if (analysis.questions.length > 0) return "Decomposition must not contain questions.";
  if (analysis.subfeatures.length < 2) return "Decomposition requires at least two subfeatures.";

  const roots = analysis.subfeatures.filter((item) => item.depends_on.length === 0);
  if (roots.length < 2) return "Decomposition requires at least two independently useful roots.";

  const factIds = new Set(extraction.facts.map((fact) => fact.id));
  const featureNames = new Set<string>();
  const citedFacts = new Set<string>();
  for (const subfeature of analysis.subfeatures) {
    const feature = subfeature.feature.trim().toLocaleLowerCase();
    if (!feature || featureNames.has(feature))
      return "Subfeature names must be unique and non-empty.";
    featureNames.add(feature);
    for (const factId of subfeature.fact_ids) {
      if (!factIds.has(factId)) return `Unknown supporting fact ID: ${factId}.`;
      if (citedFacts.has(factId)) return `Supporting fact ${factId} is reused.`;
      citedFacts.add(factId);
    }
  }
  return null;
}

function conservativeAnalysis(
  proposed: Analysis,
  reviewed: Analysis,
  repositoryContextAvailable: boolean,
): Analysis {
  if (repositoryContextAvailable) return reviewed;
  if (proposed.decision === "needs_clarification" && reviewed.decision === "ready") {
    return proposed;
  }
  return reviewed;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
