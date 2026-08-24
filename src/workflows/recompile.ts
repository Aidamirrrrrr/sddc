import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ModelClient } from "../ai/model-client";
import { finish, step, success } from "../cli/ui";
import { preparePlanningContext } from "../planning/pipeline";
import { readImplementationPlan, writeImplementationPlan } from "../planning/storage";
import { loadConstitution } from "../policy/constitution";
import { loadPolicy } from "../policy/load";
import { readRepositoryDiscovery, readSpec } from "../spec/storage";
import { readTaskList, writeTaskList } from "../tasks/storage";
import { runApprovedExecution } from "./execution";
import { persistGovernance } from "./governance";
import { createApprovedPlan } from "./planning";
import { createApprovedTaskList } from "./tasks";

export type RecompilePhase = "plan" | "tasks" | "execute";

/**
 * Rebuilds the downstream artifacts of a stored feature. Editing `spec.yaml` and recompiling from
 * `plan` is the pivot path: the specification stays the source of truth and everything below it is
 * regenerated instead of hand-patched.
 */
export async function runRecompile(
  client: ModelClient,
  root: string,
  phase: RecompilePhase,
  requestedFeature: string,
  dryRun: boolean,
): Promise<void> {
  const feature = requestedFeature || (await onlyStoredFeature(root));
  const spec = await readSpec(root, feature);
  const discovery = await readRepositoryDiscovery(root, feature);
  const policy = await loadPolicy(root);
  const constitution = await loadConstitution(root);
  const repository = await preparePlanningContext(root, discovery);
  const total = phase === "plan" ? 3 : phase === "tasks" ? 2 : 1;
  let completed = 0;
  const next = (): number => {
    completed += 1;
    return completed;
  };

  let plan = await readStoredPlan(root, feature, phase);
  if (!plan) {
    step(next(), total, { en: "Rebuild the plan", ru: "Пересборка плана" });
    plan = await createApprovedPlan(client, spec, discovery, policy, repository, constitution);
    const path = await writeImplementationPlan(plan);
    success({ en: `Technical plan saved to ${path}`, ru: `План сохранён: ${path}` });
  }

  let tasks = phase === "execute" ? await readTaskList(root, feature) : null;
  if (!tasks) {
    step(next(), total, { en: "Rebuild the task graph", ru: "Пересборка графа задач" });
    tasks = await createApprovedTaskList(
      client,
      spec,
      plan,
      discovery,
      policy,
      repository,
      constitution,
    );
    const path = await writeTaskList(tasks, root);
    success({ en: `Task graph saved to ${path}`, ru: `Граф задач сохранён: ${path}` });
    await persistGovernance(root, spec, discovery, plan, tasks, policy);
  }

  if (dryRun) {
    finish({
      en: "Dry run complete; no source files were changed",
      ru: "Пробный запуск завершён; исходные файлы не изменены",
    });
    return;
  }
  step(next(), total, {
    en: "Controlled implementation",
    ru: "Контролируемая реализация",
  });
  await runApprovedExecution(client, root, spec, plan, tasks, policy);
}

async function readStoredPlan(root: string, feature: string, phase: RecompilePhase) {
  return phase === "plan" ? null : readImplementationPlan(root, feature);
}

async function onlyStoredFeature(root: string): Promise<string> {
  const entries = await readdir(join(root, ".specs"), { withFileTypes: true }).catch(() => []);
  const features = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (features.length === 1 && features[0]) return features[0];
  throw new Error(
    features.length === 0
      ? "No stored feature found in .specs"
      : `Name the feature to recompile: ${features.join(", ")}`,
  );
}
