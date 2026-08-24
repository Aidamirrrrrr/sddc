import { expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { buildDecisionRegistry } from "./build";

test("decision registry records provenance and accepted permissions", () => {
  const spec = readySpec();
  const repository = discovery();
  repository.context.user_context = "Keep the current auth module";
  const plan = readyPlan();
  plan.decisions = [
    { statement: "Reuse AuthService", rationale: "Existing service", evidence: ["src/auth.ts"] },
  ];
  plan.tasks[0]?.permissions.push("configuration");

  const registry = buildDecisionRegistry(spec, repository, plan);

  expect(registry.decisions.map((decision) => decision.id)).toEqual(["D1", "D2", "D3", "D4"]);
  expect(registry.decisions[0]).toMatchObject({ owner: "user", source: "spec.R1" });
  expect(registry.decisions[2]).toMatchObject({
    owner: "agent",
    source: "plan.decisions",
    evidence: ["src/auth.ts"],
  });
  expect(registry.decisions[3]).toMatchObject({
    kind: "permission",
    owner: "user",
    statement: "T1: configuration",
  });
});
