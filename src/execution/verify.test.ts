import { expect, test } from "bun:test";
import { readyTasks } from "../tasks/test-fixtures";
import { runVerification } from "./verify";

test("verification does not run a command rejected by the user", async () => {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  task.verification = [
    { command: { program: "bun", args: ["-e", "process.exit(0)"] }, purpose: "Test" },
  ];

  const result = await runVerification(process.cwd(), task, {
    async approve() {
      return false;
    },
  });

  expect(result[0]?.exit_code).toBe(126);
  expect(result[0]?.output).toBe("Command rejected by user");
});
