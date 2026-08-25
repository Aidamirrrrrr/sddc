import { basename } from "node:path";
import { render } from "ink";
import type { Driver } from "../driver";
import { App } from "./App";
import { applyStep, createStore, markCurrentPhase, type Pending } from "./store";

let instance: { unmount: () => void } | undefined;

/**
 * Mounts the application surface and returns a driver that speaks to it.
 *
 * Ink owns stdout while mounted, so nothing else may write there: every surface the pipeline uses
 * has to go through this driver or the live frame is corrupted.
 */
export function startApp(root = process.cwd()): Driver {
  const store = createStore();
  let suspendTerminal: ((operation: () => Promise<unknown>) => Promise<unknown>) | undefined;
  instance = render(
    <App
      store={store}
      subtitle={basename(root)}
      onReady={({ suspend }) => {
        suspendTerminal = suspend;
      }}
    />,
    { exitOnCtrlC: false },
  );

  /** Parks a promise on the store until the rendered prompt resolves it. */
  const ask = <T,>(build: (resolve: (value: T) => void) => Pending): Promise<T> =>
    new Promise<T>((resolve) => {
      const pending = build((value) => {
        store.update((state) => ({ ...state, pending: undefined }));
        resolve(value);
      });
      store.update((state) => ({ ...state, pending }));
    });

  const remember = (question: string, answer: string): void => {
    store.push({ kind: "answer", question, answer });
  };

  return {
    begin: (title) => store.update((state) => ({ ...state, heading: title })),
    banner: (details) => store.push({ kind: "banner", ...details }),
    // Nothing announces the end of the last phase, so completing the run closes it.
    finish: (message) =>
      store.update((state) => ({ ...markCurrentPhase(state, "done"), finished: message })),
    info: (text) => store.push({ kind: "line", tone: "info", text }),
    success: (text) => store.push({ kind: "line", tone: "success", text }),
    warn: (text) => store.push({ kind: "line", tone: "warn", text }),
    step: (current, total, label) =>
      store.update((state) => applyStep(state, current, total, label)),
    document: (title, body) => store.push({ kind: "panel", title, body }),
    action: (summary, details, tone = "success") =>
      store.push({ kind: "action", tone, title: summary, details }),
    async stage(labels, operation) {
      store.update((state) => ({ ...state, stage: labels.progress, stageStartedAt: Date.now() }));
      try {
        const result = await operation();
        store.update((state) => ({ ...state, stage: undefined, stageStartedAt: undefined }));
        store.push({ kind: "line", tone: "success", text: labels.complete });
        return result;
      } catch (error) {
        store.update((state) =>
          markCurrentPhase({ ...state, stage: undefined, stageStartedAt: undefined }, "failed"),
        );
        store.push({ kind: "line", tone: "danger", text: labels.failed });
        throw error;
      }
    },
    async select(message, choices, initial) {
      const value = await ask<string>((resolve) => ({
        kind: "select",
        message,
        choices,
        initial,
        resolve,
      }));
      const chosen = choices.find((choice) => choice.value === value);
      remember(message, chosen?.label ?? value);
      return value as never;
    },
    async multiselect(message, choices, initial) {
      const values = await ask<string[]>((resolve) => ({
        kind: "multiselect",
        message,
        choices,
        initial,
        resolve,
      }));
      remember(message, `${values.length} selected`);
      return values as never;
    },
    async confirm(message, initial) {
      const value = await ask<boolean>((resolve) => ({
        kind: "confirm",
        message,
        initial,
        resolve,
      }));
      remember(message, value ? "yes" : "no");
      return value;
    },
    async text(message, options = {}) {
      const value = await ask<string>((resolve) => ({ kind: "text", message, options, resolve }));
      remember(message, value);
      return value;
    },
    nextRequest() {
      return new Promise<string>((resolve) => {
        store.update((state) => ({
          ...state,
          // A finished run leaves its banner up; arriving back at the prompt clears it so the next
          // request does not read as a continuation of the last one's ending.
          finished: undefined,
          stage: undefined,
          awaitingRequest: (request) => {
            store.update((current) => ({ ...current, awaitingRequest: undefined }));
            store.push({ kind: "command", text: request });
            resolve(request);
          },
        }));
      });
    },
    cancel(message) {
      store.update((state) => ({ ...state, pending: undefined, finished: message }));
      stopApp();
      process.exit(0);
    },
    async suspend<T>(operation: () => Promise<T>): Promise<T> {
      // Before the tree has mounted there is nothing holding the screen, so just run it.
      if (!suspendTerminal) return operation();
      return (await suspendTerminal(operation as () => Promise<unknown>)) as T;
    },
  };
}

/** Releases stdout so errors and trailing output are not swallowed by the live frame. */
export function stopApp(): void {
  instance?.unmount();
  instance = undefined;
}
