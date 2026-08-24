import { expect, test } from "bun:test";
import { specificationLanguage } from "./language";
import { specSchema } from "./schemas";

test("detects the specification prose language for downstream stages", () => {
  const base = {
    status: "ready" as const,
    feature: "cookie-service",
    acceptance: [],
    issues: [],
    questions: [],
    subfeatures: [],
  };
  const russian = specSchema.parse({
    ...base,
    goal: "Вынести работу с cookie в сервис",
    requirements: [{ id: "R1", statement: "Создать сервис" }],
  });
  const english = specSchema.parse({
    ...base,
    goal: "Extract cookie handling into a service",
    requirements: [{ id: "R1", statement: "Create the service" }],
  });

  expect(specificationLanguage(russian)).toBe("Russian");
  expect(specificationLanguage(english)).toBe("English");
});
