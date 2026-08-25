import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { buildSpec } from "./pipeline";

class StubModelClient {
  readonly inputs: string[] = [];
  private readonly responses: unknown[];

  constructor(...responses: unknown[]) {
    this.responses = responses;
  }

  async generateObject<T>(_system: string, prompt: string, _schema: z.ZodType<T>): Promise<T> {
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

const ready = {
  decision: "ready",
  rationale: "Данных достаточно.",
  questions: [],
  subfeatures: [],
};

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
      { id: "source-acceptance", verifies: ["source-id"], statement: "Пользователь создан." },
    ],
    issues: [],
    questions: [],
    subfeatures: [],
  };
}

describe("specification flow", () => {
  test("stops an abstract request after reviewed analysis", async () => {
    const clarification = {
      decision: "needs_clarification",
      rationale: "Не определено поведение.",
      questions: [{ question: "Какие данные вводит пользователь?", reason: "Нужен вход." }],
      subfeatures: [],
    };
    const client = new StubModelClient(
      extraction(["Добавить регистрацию пользователей."]),
      clarification,
      clarification,
    );

    const spec = await buildSpec(client, "Добавь регистрацию пользователей.");

    expect(spec.status).toBe("needs_clarification");
    expect(spec.questions[0]?.question).toBe("Какие данные вводит пользователь?");
    expect(client.remaining()).toBe(0);
  });

  test("checks an incomplete request containing several facts", async () => {
    const clarification = {
      decision: "needs_clarification",
      rationale: "Не определён конфликт.",
      questions: [
        {
          question: "Что происходит, если email уже зарегистрирован?",
          reason: "Результат конфликта не определён.",
        },
      ],
      subfeatures: [],
    };
    const client = new StubModelClient(
      extraction(["Пользователь вводит email.", "Система создаёт учётную запись."]),
      clarification,
      ready,
    );

    const spec = await buildSpec(client, "Регистрация по email создаёт учётную запись.");

    expect(spec.status).toBe("needs_clarification");
    expect(spec.requirements).toHaveLength(2);
    expect(client.remaining()).toBe(0);
  });

  test("builds and normalizes a ready specification in five calls", async () => {
    const candidate = readySpec();
    const client = new StubModelClient(
      extraction([
        "Пользователь вводит email.",
        "Система создаёт пользователя.",
        "Система показывает успешный результат.",
      ]),
      ready,
      ready,
      candidate,
      { spec: candidate, checks: checks() },
    );

    const spec = await buildSpec(client, "Полное описание регистрации.");

    expect(spec.status).toBe("ready");
    expect(spec.requirements[0]?.id).toBe("R1");
    expect(spec.acceptance[0]).toMatchObject({ id: "A1", verifies: ["R1"] });
    expect(client.inputs).toHaveLength(5);
  });

  test("an unusable draw from the writer is redrawn instead of ending the run", async () => {
    const candidate = readySpec();
    // A criterion verifying a requirement that does not exist: normalizing drops the reference and
    // the spec then fails its own coverage check. That used to end the run outright.
    const broken = {
      ...candidate,
      acceptance: [{ id: "A1", verifies: ["nothing"], statement: "Пользователь создан." }],
    };
    const client = new StubModelClient(
      extraction(["Система создаёт пользователя."]),
      ready,
      ready,
      broken,
      { spec: broken, checks: checks() },
      candidate,
      { spec: candidate, checks: checks() },
    );

    const spec = await buildSpec(client, "Полное описание регистрации.");

    expect(spec.status).toBe("ready");
    expect(spec.acceptance[0]).toMatchObject({ id: "A1", verifies: ["R1"] });
    // The second draw was told what was wrong with the first.
    expect(client.inputs.at(-2)).toContain("validationError");
  });

  test("a phase that never produces a valid specification still fails", async () => {
    const broken = {
      ...readySpec(),
      acceptance: [{ id: "A1", verifies: ["nothing"], statement: "Пользователь создан." }],
    };
    const client = new StubModelClient(
      extraction(["Система создаёт пользователя."]),
      ready,
      ready,
      ...Array.from({ length: 3 }, () => [broken, { spec: broken, checks: checks() }]).flat(),
    );

    expect(buildSpec(client, "Полное описание регистрации.")).rejects.toThrow(
      "Requirements without acceptance coverage",
    );
  });

  test("drops a repository question answered by approved code context", async () => {
    const unnecessaryQuestion = {
      decision: "needs_clarification",
      rationale: "Неизвестна сигнатура.",
      questions: [
        {
          question: "Какие параметры принимает setRefreshCookie?",
          reason: "Нужен текущий контракт.",
        },
      ],
      subfeatures: [],
    };
    const candidate = readySpec();
    const client = new StubModelClient(
      extraction(["Перенести setRefreshCookie в cookie.service.ts."]),
      unnecessaryQuestion,
      ready,
      candidate,
      { spec: candidate, checks: checks() },
    );

    const spec = await buildSpec(client, "Перенести setRefreshCookie в cookie.service.ts.", {
      files: ["auth.service.ts"],
      userContext: "",
      snapshots: [
        {
          path: "auth.service.ts",
          size: 55,
          content: "setRefreshCookie(token: string, response: Response): void {}",
        },
      ],
    });

    expect(spec.status).toBe("ready");
    expect(client.inputs[1]).toContain("setRefreshCookie(token: string");
    expect(client.inputs).toHaveLength(5);
  });

  test("repairs a structurally invalid product analysis once", async () => {
    const invalid = {
      decision: "needs_decomposition",
      rationale: "Ошибочное разделение.",
      questions: [],
      subfeatures: [
        {
          id: "S1",
          feature: "registration",
          goal: "Успех.",
          fact_ids: ["F1"],
          depends_on: [],
        },
        {
          id: "S2",
          feature: "registration",
          goal: "Ошибка.",
          fact_ids: ["F2"],
          depends_on: [],
        },
      ],
    };
    const candidate = readySpec();
    const client = new StubModelClient(
      extraction([
        "Пользователь вводит email.",
        "Система создаёт пользователя.",
        "Система показывает успешный результат.",
      ]),
      invalid,
      invalid,
      ready,
      candidate,
      { spec: candidate, checks: checks() },
    );

    const spec = await buildSpec(client, "Один сценарий регистрации.");

    expect(spec.status).toBe("ready");
    expect(client.inputs[3]).toContain("Subfeature names must be unique");
    expect(client.remaining()).toBe(0);
  });

  test("returns a grounded product-level decomposition in three calls", async () => {
    const decomposition = {
      decision: "needs_decomposition",
      rationale: "Два независимых результата.",
      questions: [],
      subfeatures: [
        {
          id: "S1",
          feature: "registration",
          goal: "Регистрация.",
          fact_ids: ["F1"],
          depends_on: [],
        },
        {
          id: "S2",
          feature: "billing",
          goal: "Оплата.",
          fact_ids: ["F2"],
          depends_on: [],
        },
      ],
    };
    const client = new StubModelClient(
      extraction(["Добавить регистрацию.", "Добавить оплату."]),
      decomposition,
      decomposition,
    );

    const spec = await buildSpec(client, "Добавить регистрацию и оплату.");

    expect(spec.status).toBe("needs_decomposition");
    expect(spec.subfeatures.map((item) => item.id)).toEqual(["F1", "F2"]);
    expect(client.inputs).toHaveLength(3);
  });
});
