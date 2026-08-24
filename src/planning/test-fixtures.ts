import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { ImplementationPlan } from "./schemas";

export function readyPlan(): ImplementationPlan {
  return {
    status: "ready",
    feature: "registration",
    summary: "Implement registration in two focused steps.",
    decisions: [],
    approach: [
      {
        id: "S1",
        statement: "Add the registration operation to the auth module.",
        requirements: ["R1"],
        touches: ["src/auth.ts"],
      },
    ],
    contracts: [],
    data_model: [],
    questions: [],
  };
}

export function readySpec(): Spec {
  return {
    status: "ready",
    feature: "registration",
    goal: "Register users",
    requirements: [{ id: "R1", statement: "A user can register" }],
    acceptance: [{ id: "A1", verifies: ["R1"], statement: "Registration succeeds" }],
    issues: [],
    questions: [],
    subfeatures: [],
  };
}

export function discovery(): RepositoryDiscovery {
  return {
    context: { files: ["src/auth.ts"], user_context: "" },
    summary: "Authentication module",
    technologies: [],
    structure: [],
    relevant_files: [{ path: "src/auth.ts", purpose: "Auth", symbols: [] }],
    conventions: [],
    testing: [],
    constraints: [],
    unknowns: [],
  };
}
