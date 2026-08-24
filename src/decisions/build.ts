import type { ImplementationPlan } from "../planning/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { TaskList } from "../tasks/schemas";
import { type DecisionRegistry, decisionRegistrySchema } from "./schemas";

export function buildDecisionRegistry(
  spec: Spec,
  discovery: RepositoryDiscovery,
  plan: ImplementationPlan,
  tasks: TaskList,
): DecisionRegistry {
  const entries: DecisionRegistry["decisions"] = [];

  for (const requirement of spec.requirements) {
    entries.push({
      id: "",
      kind: "product",
      owner: "user",
      statement: requirement.statement,
      source: `spec.${requirement.id}`,
      evidence: [],
      status: "accepted",
    });
  }
  if (discovery.context.user_context) {
    entries.push({
      id: "",
      kind: "context",
      owner: "user",
      statement: discovery.context.user_context,
      source: "discovery.context.user_context",
      evidence: [],
      status: "accepted",
    });
  }
  for (const decision of plan.decisions) {
    entries.push({
      id: "",
      kind: "implementation",
      owner: "agent",
      statement: decision.statement,
      source: "plan.decisions",
      evidence: decision.evidence,
      status: "accepted",
    });
  }
  for (const task of tasks.tasks) {
    for (const permission of task.permissions) {
      entries.push({
        id: "",
        kind: "permission",
        owner: "user",
        statement: `${task.id}: ${permission}`,
        source: `tasks.${task.id}.permissions`,
        evidence: [],
        status: "accepted",
      });
    }
  }

  return decisionRegistrySchema.parse({
    feature: spec.feature,
    decisions: entries.map((entry, index) => ({ ...entry, id: `D${index + 1}` })),
  });
}
