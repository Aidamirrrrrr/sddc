import { type Copy, t } from "./language";

/**
 * Something to read while a stage thinks.
 *
 * A wait is where people learn what a tool can do, because it is the only moment they are looking at
 * it and not doing anything. These are about this pipeline specifically — the things that are hard
 * to discover from the outside because they are decisions the host makes rather than buttons.
 */
const TIPS: Copy[] = [
  {
    en: "Waves come from the dependency graph, never from the model — independent tasks run together.",
    ru: "Волны считаются по графу зависимостей, а не заявляются моделью: независимые задачи идут вместе.",
  },
  {
    en: "An acceptance criterion belongs to the task that writes its test. The host decides which.",
    ru: "Критерий приёмки принадлежит задаче, которая пишет его тест. Кто именно — решает хост.",
  },
  {
    en: "With test-first on, a test task is required to fail. A test that passes early asserts nothing.",
    ru: "При test-first тестовая задача обязана упасть: тест, проходящий сразу, ничего не утверждает.",
  },
  {
    en: "Every write is confined to the files its task declared. A proposal reaching past them is refused.",
    ru: "Запись ограничена файлами задачи. Предложение, вышедшее за них, отклоняется.",
  },
  {
    en: "A task corrects itself against real command output, inside the scope it was already granted.",
    ru: "Задача правит себя по реальному выводу команд, не выходя за выданную ей область.",
  },
  {
    en: "Press escape to stop. It cuts the open request and refuses to start the next one.",
    ru: "Escape останавливает: режет открытый запрос и не даёт начать следующий.",
  },
  {
    en: "/status says what this run has done and what it has cost, without interrupting it.",
    ru: "/status покажет, что сделано и сколько стоило, не прерывая работу.",
  },
  {
    en: "Editing spec.yaml and running --recompile plan rebuilds everything below it.",
    ru: "Правка spec.yaml и --recompile plan пересобирают всё, что ниже неё.",
  },
  {
    en: "--eval scores a recorded corpus with the same validators, offline and in milliseconds.",
    ru: "--eval прогоняет записанный корпус теми же валидаторами — офлайн и за миллисекунды.",
  },
  {
    en: "Every phase is bounded, and so is the run: budget.max_model_calls is the ceiling on all of them.",
    ru: "Ограничена каждая фаза и весь прогон: budget.max_model_calls — общий потолок.",
  },
  {
    en: "Answers you type during a phase travel forward: the implementation phase sees them too.",
    ru: "Ваши ответы едут дальше: фаза реализации тоже их видит.",
  },
  {
    en: "The task graph is drawn until one passes the validators, rather than until one is returned.",
    ru: "Граф задач тянется, пока не пройдёт валидаторы, а не пока просто не вернётся.",
  },
];

let remaining: Copy[] = [];

/**
 * The next tip, in a shuffled cycle.
 *
 * Refilled only once every tip has been shown, so nothing repeats until everything has appeared —
 * a plain random pick would show the same line twice in one wait often enough to look broken.
 */
export function nextTip(): string {
  if (remaining.length === 0) remaining = shuffle(TIPS);
  const tip = remaining.pop();
  return tip ? t(tip) : "";
}

export function resetTips(): void {
  remaining = [];
}

/** Exposed so a test can check the cycle covers everything rather than guessing at randomness. */
export function tipCount(): number {
  return TIPS.length;
}

function shuffle(items: Copy[]): Copy[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const left = copy[index];
    const right = copy[swap];
    if (left && right) {
      copy[index] = right;
      copy[swap] = left;
    }
  }
  return copy;
}
