import { expect, test } from "bun:test";
import type { z } from "zod";
import { classifyRequest } from "./classify";

test("classifies a repository explanation without entering specification flow", async () => {
  const client = {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return {
        intent: "inquiry",
        language: "Russian",
        rationale: "Пользователь просит объяснение существующего поведения.",
        question: "",
      } as T;
    },
  };

  expect(
    await classifyRequest(client, "расскажи как работает регистрация в проекте"),
  ).toMatchObject({
    intent: "inquiry",
    question: "",
  });
});
