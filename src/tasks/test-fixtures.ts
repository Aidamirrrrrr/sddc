import type { TaskList } from "./schemas";

export function readyTasks(): TaskList {
  return {
    status: "ready",
    feature: "registration",
    summary: "Implement registration in two focused tasks.",
    tasks: [
      {
        id: "T1",
        title: "Implement registration",
        goal: "Add the registration operation.",
        requirements: ["R1"],
        // Serves the requirement; the criterion belongs to the task whose test verifies it.
        acceptance: [],
        depends_on: [],
        permissions: [],
        files: { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [] },
        verification: [{ command: { program: "bun", args: ["test"] }, purpose: "Run tests" }],
        done_when: ["Registration succeeds"],
        risks: [],
        wave: 1,
        parallel: false,
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
        wave: 2,
        parallel: false,
      },
    ],
    questions: [],
  };
}
