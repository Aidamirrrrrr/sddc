import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { buildSpec } from "./pipeline";

class StubModelClient {
  readonly prompts: string[] = [];
  readonly inputs: string[] = [];
  private readonly responses: unknown[];

  constructor(...responses: unknown[]) {
    this.responses = responses;
  }

  async generateObject<T>(system: string, prompt: string, _schema: z.ZodType<T>): Promise<T> {
    this.prompts.push(system);
    this.inputs.push(prompt);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("Unexpected model call");
    return response as T;
  }

  remaining(): number {
    return this.responses.length;
  }
}

const extraction = (facts: string[]) => ({
  language: "Russian",
  feature: "user-registration",
  goal: "Добавить регистрацию пользователей.",
  facts: facts.map((statement, index) => ({
    id: `F${index + 1}`,
    statement,
    source_excerpt: statement,
  })),
});

const complete = { decision: "complete", rationale: "Данных достаточно.", questions: [] };
const emptyAmbiguity = { issues: [], questions: [] };
const emptyFilter = { kept_issue_ids: [], kept_question_ids: [] };
const focused = { decision: "focused", rationale: "Один сценарий.", subfeatures: [] };

function checks() {
  return Array.from({ length: 15 }, (_, index) => ({
    id: `C${index + 1}`,
    passed: true,
    finding: "Проверено.",
  }));
}

function readySpec() {
  return {
    status: "ready",
    feature: "user-registration",
    goal: "Добавить регистрацию пользователей.",
    requirements: [{ id: "source-id", statement: "Система создаёт пользователя." }],
    acceptance: [
      {
        id: "source-acceptance",
        verifies: ["source-id"],
        statement: "Пользователь создан.",
      },
    ],
    issues: [],
    questions: [],
    subfeatures: [],
  };
}

describe("specification flow", () => {
  test("stops an abstract request and asks blocking questions", async () => {
    const client = new StubModelClient(extraction(["Добавить регистрацию пользователей."]), {
      decision: "needs_clarification",
      rationale: "Не определено поведение.",
      questions: [{ question: "Какие данные вводит пользователь?", reason: "Нужен вход." }],
    });

    const spec = await buildSpec(client, "Добавь регистрацию пользователей.");

    expect(spec.status).toBe("needs_clarification");
    expect(spec.questions[0]?.question).toBe("Какие данные вводит пользователь?");
    expect(client.remaining()).toBe(0);
  });

  test("checks completeness even when an incomplete request contains several facts", async () => {
    const client = new StubModelClient(
      extraction(["Пользователь вводит email.", "Система создаёт учётную запись."]),
      {
        decision: "needs_clarification",
        rationale: "Не определён конфликт.",
        questions: [
          {
            question: "Что происходит, если email уже зарегистрирован?",
            reason: "Результат конфликта не определён.",
          },
        ],
      },
    );

    const spec = await buildSpec(client, "Регистрация по email создаёт учётную запись.");

    expect(spec.status).toBe("needs_clarification");
    expect(spec.requirements).toHaveLength(2);
    expect(client.remaining()).toBe(0);
  });

  test("builds and normalizes a complete focused specification", async () => {
    const candidate = readySpec();
    const client = new StubModelClient(
      extraction(["Пользователь вводит email.", "Система создаёт пользователя."]),
      complete,
      emptyAmbiguity,
      emptyFilter,
      focused,
      focused,
      candidate,
      { spec: candidate, checks: checks() },
    );

    const spec = await buildSpec(client, "Полное описание регистрации.");

    expect(spec.status).toBe("ready");
    expect(spec.requirements[0]?.id).toBe("R1");
    expect(spec.acceptance[0]).toMatchObject({ id: "A1", verifies: ["R1"] });
    expect(client.remaining()).toBe(0);
  });

  test("passes only reviewer-approved ambiguity into the writer", async () => {
    const proposed = {
      issues: [
        { id: "I1", kind: "missing", statement: "Нужен результат.", affects: ["F1"] },
        { id: "I2", kind: "missing", statement: "Нужна база данных.", affects: ["F2"] },
      ],
      questions: [
        { id: "Q1", question: "Каков результат?", reason: "Важно.", affects: ["F1"] },
        { id: "Q2", question: "Какая база?", reason: "Техническое.", affects: ["F2"] },
      ],
    };
    const candidate = readySpec();
    const client = new StubModelClient(
      extraction(["Пользователь вводит email.", "Регистрация запускается кнопкой."]),
      complete,
      proposed,
      { kept_issue_ids: ["I1"], kept_question_ids: ["Q1"] },
      focused,
      focused,
      candidate,
      { spec: candidate, checks: checks() },
    );

    await buildSpec(client, "Описание с неоднозначностью.");
    const writerInput = client.inputs[6] ?? "";

    expect(writerInput).toContain("Каков результат?");
    expect(writerInput).not.toContain("Какая база?");
  });

  test("returns product-level decomposition from the reviewed specification", async () => {
    const decomposed = {
      ...readySpec(),
      status: "needs_decomposition",
      requirements: [],
      acceptance: [],
      subfeatures: [
        { id: "S1", feature: "registration", goal: "Регистрация.", depends_on: [] },
        { id: "S2", feature: "billing", goal: "Оплата.", depends_on: ["S1"] },
      ],
    };
    const scope = {
      decision: "decompose",
      rationale: "Два независимых результата.",
      subfeatures: decomposed.subfeatures,
    };
    const client = new StubModelClient(
      extraction(["Добавить регистрацию.", "Добавить оплату."]),
      complete,
      emptyAmbiguity,
      emptyFilter,
      scope,
      scope,
      decomposed,
      { spec: decomposed, checks: checks() },
    );

    const spec = await buildSpec(client, "Добавить регистрацию и оплату.");

    expect(spec.status).toBe("needs_decomposition");
    expect(spec.subfeatures.map((item) => item.id)).toEqual(["F1", "F2"]);
    expect(client.remaining()).toBe(0);
  });
});
