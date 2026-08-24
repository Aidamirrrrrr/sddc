import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { answerRepositoryInquiry } from "./pipeline";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("answers from approved repository evidence without creating a specification", async () => {
  root = await mkdtemp(join(tmpdir(), "sddc-inquiry-"));
  await Bun.write(join(root, "auth.ts"), "export function register() { return 'created'; }");
  await Bun.write(join(root, "unrelated.ts"), "export const secretBehavior = true;");
  const prompts: string[] = [];
  const responses = [
    { files: [{ path: "auth.ts", reason: "Registration flow" }], rationale: "Relevant" },
    { files: [], rationale: "Enough context" },
    {
      answer: "Регистрация возвращает created.",
      evidence: [{ path: "auth.ts", finding: "Функция register возвращает created." }],
      unknowns: [],
    },
    {
      answer: "Регистрация возвращает created.",
      evidence: [
        { path: "auth.ts", finding: "Функция register возвращает created." },
        { path: "missing.ts", finding: "Несуществующее подтверждение." },
      ],
      unknowns: [],
    },
  ];
  const client = {
    async generateObject<T>(_system: string, prompt: string, _schema: z.ZodType<T>): Promise<T> {
      prompts.push(prompt);
      return responses.shift() as T;
    },
  };

  const answer = await answerRepositoryInquiry(
    client,
    "расскажи как работает регистрация",
    "Russian",
    root,
    async (selection, _index, current) => ({
      files: current?.files ?? selection.files.map((file) => file.path),
      userContext: "",
    }),
  );

  expect(answer.evidence).toEqual([
    { path: "auth.ts", finding: "Функция register возвращает created." },
  ]);
  expect(prompts[2]).toContain("export function register");
  expect(prompts[2]).not.toContain("secretBehavior");
});
