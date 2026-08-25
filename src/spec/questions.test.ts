import { expect, test } from "bun:test";
import { normalizeClarificationQuestions } from "./validate";

function stripped(question: string): string {
  return normalizeClarificationQuestions([{ question, reason: "" }])[0]?.question ?? "";
}

test("a parenthesised example is removed", () => {
  expect(stripped("Which roles may publish (for example editor or admin)?")).toBe(
    "Which roles may publish?",
  );
});

test("a trailing example clause is removed without taking the sentence marker", () => {
  expect(stripped("Что происходит при повторе, например при двойном клике?")).toBe(
    "Что происходит при повторе?",
  );
});

test("questions after the example survive", () => {
  // Cutting to the end of the string deleted every following question, so one over-helpful clause
  // silently swallowed the rest of what the user was being asked.
  expect(stripped("Что происходит при повторе, например при двойном клике? Нужен ли лимит?")).toBe(
    "Что происходит при повторе? Нужен ли лимит?",
  );
});

test("a question with no example is left exactly as it is", () => {
  expect(stripped("What happens when the tag is empty?")).toBe(
    "What happens when the tag is empty?",
  );
});
