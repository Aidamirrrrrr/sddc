import { expect, test } from "bun:test";
import { detectLanguage, specificationLanguage } from "./language";
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

test("a quoted Russian literal does not make an English document Russian", () => {
  // The label decides what language every downstream stage writes in, so one borrowed string in a
  // code example used to flip a whole English specification.
  const english =
    "The endpoint returns the stored greeting verbatim, including the seeded value 'Привет'," +
    " and never re-encodes it before writing the response body to the client.";

  expect(detectLanguage(english)).toBe("English");
});

test("Russian prose full of code identifiers is still Russian", () => {
  const russian =
    "Функция addNote принимает необязательный параметр tag и сохраняет его в поле Note.tag," +
    " а listNotesByTag возвращает заметки, отсортированные по createdAt.";

  expect(detectLanguage(russian)).toBe("Russian");
});

test("text with no Cyrillic at all is English without arithmetic", () => {
  expect(detectLanguage("Create the service", undefined, "")).toBe("English");
});
