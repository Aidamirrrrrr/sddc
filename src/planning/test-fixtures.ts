import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { ImplementationPlan } from "./schemas";

export function readyPlan(): ImplementationPlan {
  return {
    status: "ready",
    feature: "registration",
    summary: "Implement registration in two focused tasks.",
    decisions: [],
    tasks: [
      {
        id: "T1",
        title: "Implement registration",
        goal: "Add the registration operation.",
        requirements: ["R1"],
        acceptance: ["A1"],
        depends_on: [],
        permissions: [],
        files: { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [] },
        verification: [{ command: { program: "bun", args: ["test"] }, purpose: "Run tests" }],
        done_when: ["Registration succeeds"],
        risks: [],
      },
      {
        id: "T2",
        title: "Verify registration",
        goal: "Cover the registration behavior.",
        requirements: ["R1"],
        acceptance: ["A1"],
        depends_on: ["T1"],
        permissions: [],
        files: { read: ["src/auth.ts"], modify: [], create: ["src/auth.test.ts"] },
        verification: [{ command: { program: "bun", args: ["test"] }, purpose: "Run tests" }],
        done_when: ["Acceptance behavior is covered"],
        risks: [],
      },
    ],
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
