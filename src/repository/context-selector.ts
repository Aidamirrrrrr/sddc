import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { autocompleteMultiselect, cancel, isCancel, note, select, text } from "@clack/prompts";
import { accent, phrase } from "../cli/ui";
import type { ContextSelector, RepositoryContext } from "./pipeline";
import { listContextProfiles, writeContextProfile } from "./profiles";
import { MAX_FILE_BYTES, MAX_SNAPSHOT_BYTES } from "./scan";

const MAX_SELECTED_FILES = 24;
const PREVIEW_CHARACTERS = 12_000;

type ContextCost = { inputUsdPerMillion?: number };

export function createRepositoryContextSelector(
  root: string,
  cost: ContextCost = {},
): ContextSelector {
  return async (selection, index, current) => {
    const reasons = new Map(selection.files.map((file) => [file.path, file.reason]));
    const sizes = new Map(index.map((file) => [file.path, file.size]));
    let context: RepositoryContext = current ?? {
      files: selection.files.map((file) => file.path),
      userContext: "",
    };
    context.files = safePaths(context.files, sizes);

    while (true) {
      showEstimate(context.files, sizes, cost, reasons, current?.files ?? []);
      const added = current
        ? context.files.filter((path) => !current.files.includes(path)).length
        : 0;
      const action = unwrap(
        await select({
          message: current
            ? phrase({
                en: `Review ${added} additional context file${added === 1 ? "" : "s"}`,
                ru: `Проверьте новые файлы контекста: ${added}`,
              })
            : phrase({
                en: "Review what the model may read",
                ru: "Проверьте, какие файлы сможет прочитать модель",
              }),
          options: [
            {
              value: "confirm",
              label: accent(
                phrase({ en: "Continue with these files", ru: "Продолжить с этими файлами" }),
              ),
              hint: phrase({
                en: "send the selected files to the model",
                ru: "передать выбранные файлы модели",
              }),
            },
            {
              value: "edit",
              label: phrase({ en: "Review file selection", ru: "Проверить список файлов" }),
              hint: phrase({ en: "search, add, or remove", ru: "найти, добавить или убрать" }),
            },
            {
              value: "preview",
              label: phrase({ en: "Open a selected file", ru: "Открыть выбранный файл" }),
            },
            {
              value: "context",
              label: phrase({
                en: "Add a note for the model",
                ru: "Добавить пояснение для модели",
              }),
              hint: phrase({
                en: "facts that are not in the code",
                ru: "факты, которых нет в коде",
              }),
            },
            {
              value: "profiles",
              label: phrase({ en: "Context profiles", ru: "Профили контекста" }),
              hint: phrase({
                en: "load or save this selection",
                ru: "загрузить или сохранить набор",
              }),
            },
          ],
        }),
      );

      if (action === "edit") context.files = await editFiles(index, context.files, reasons, sizes);
      if (action === "preview") await previewFile(root, context.files);
      if (action === "context") context.userContext = await editUserContext(context.userContext);
      if (action === "profiles") context = await manageProfiles(root, context, sizes);
      if (action === "confirm") {
        const error = validateSelection(sizes)(context.files);
        if (error) note(error, phrase({ en: "Cannot continue", ru: "Нельзя продолжить" }));
        else return context;
      }
    }
  };
}

async function manageProfiles(
  root: string,
  context: RepositoryContext,
  sizes: Map<string, number>,
): Promise<RepositoryContext> {
  const action = unwrap(
    await select({
      message: phrase({ en: "Context profiles", ru: "Профили контекста" }),
      options: [
        { value: "load" as const, label: phrase({ en: "Load profile", ru: "Загрузить профиль" }) },
        {
          value: "save" as const,
          label: phrase({ en: "Save current selection", ru: "Сохранить текущий набор" }),
        },
        { value: "back" as const, label: phrase({ en: "Back", ru: "Назад" }) },
      ],
    }),
  );
  if (action === "load") return loadProfile(root, context, sizes);
  if (action === "save") await saveProfile(root, context);
  return context;
}

async function editFiles(
  index: Array<{ path: string; size: number }>,
  current: string[],
  reasons: Map<string, string>,
  sizes: Map<string, number>,
): Promise<string[]> {
  return unwrap(
    await autocompleteMultiselect({
      message: phrase({ en: "Select repository context", ru: "Выберите контекст репозитория" }),
      placeholder: phrase({ en: "Type to search files", ru: "Начните вводить имя файла" }),
      maxItems: 12,
      required: true,
      initialValues: current,
      options: index.map((file) => ({
        value: file.path,
        label: `[${category(file.path, reasons.has(file.path))}] ${file.path}`,
        hint:
          file.size > MAX_FILE_BYTES
            ? "too large"
            : (reasons.get(file.path) ?? formatSize(file.size)),
        disabled: file.size > MAX_FILE_BYTES,
      })),
      validate: validateSelection(sizes),
    }),
  );
}

async function previewFile(root: string, files: string[]): Promise<void> {
  if (files.length === 0)
    return note(
      phrase({ en: "Select files first", ru: "Сначала выберите файлы" }),
      phrase({ en: "Preview", ru: "Просмотр" }),
    );
  const path = unwrap(
    await select({
      message: phrase({ en: "Preview file", ru: "Посмотреть файл" }),
      maxItems: 12,
      options: files.map((file) => ({ value: file, label: file })),
    }),
  );
  const content = await readFile(join(root, path), "utf8");
  const preview = content.slice(0, PREVIEW_CHARACTERS);
  note(preview + (content.length > PREVIEW_CHARACTERS ? "\n... preview truncated" : ""), path);
}

async function editUserContext(initialValue: string): Promise<string> {
  return unwrap(
    await text({
      message: phrase({ en: "Additional project context", ru: "Дополнительный контекст проекта" }),
      placeholder: phrase({
        en: "Optional; press Enter to clear",
        ru: "Необязательно; Enter очищает поле",
      }),
      initialValue,
    }),
  ).trim();
}

async function loadProfile(
  root: string,
  fallback: RepositoryContext,
  sizes: Map<string, number>,
): Promise<RepositoryContext> {
  const profiles = await listContextProfiles(root);
  if (profiles.length === 0) {
    note(
      phrase({ en: "No saved profiles", ru: "Нет сохранённых профилей" }),
      phrase({ en: "Context profiles", ru: "Профили контекста" }),
    );
    return fallback;
  }
  const profile = unwrap(
    await select({
      message: phrase({ en: "Load context profile", ru: "Загрузить профиль контекста" }),
      options: profiles.map((item) => ({
        value: item,
        label: item.name,
        hint: `${item.files.length} files`,
      })),
    }),
  );
  return { files: safePaths(profile.files, sizes), userContext: profile.user_context };
}

async function saveProfile(root: string, context: RepositoryContext): Promise<void> {
  const name = unwrap(
    await text({
      message: phrase({ en: "Profile name", ru: "Название профиля" }),
      placeholder: "backend-auth",
      validate: (value) => (!value?.trim() ? "Name is required" : undefined),
    }),
  );
  const path = await writeContextProfile(root, {
    name: name.trim(),
    files: context.files,
    user_context: context.userContext,
  });
  note(path, phrase({ en: "Profile saved", ru: "Профиль сохранён" }));
}

export function validateSelection(sizes: Map<string, number>) {
  return (value: string | string[] | undefined): string | undefined => {
    const files = Array.isArray(value) ? value : [];
    if (files.length === 0) return "Select at least one file";
    if (files.length > MAX_SELECTED_FILES) return `Select no more than ${MAX_SELECTED_FILES} files`;
    const total = files.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
    if (total > MAX_SNAPSHOT_BYTES) {
      return `Selected context is ${formatSize(total)}; limit is ${formatSize(MAX_SNAPSHOT_BYTES)}`;
    }
    return undefined;
  };
}

export function estimateContext(bytes: number, cost: ContextCost = {}) {
  const tokens = Math.ceil(bytes / 4);
  const price = cost.inputUsdPerMillion;
  return { tokens, costUsd: price === undefined ? undefined : (tokens / 1_000_000) * price };
}

function showEstimate(
  files: string[],
  sizes: Map<string, number>,
  cost: ContextCost,
  reasons: Map<string, string>,
  previous: string[],
): void {
  const bytes = files.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
  const estimate = estimateContext(bytes, cost);
  const price =
    estimate.costUsd === undefined
      ? phrase({ en: "cost unavailable", ru: "стоимость не указана" })
      : `~$${estimate.costUsd.toFixed(4)}`;
  const added = files.filter((path) => !previous.includes(path)).length;
  const tests = files.filter((path) => category(path, reasons.has(path)) === "tests").length;
  const config = files.filter((path) => category(path, reasons.has(path)) === "config").length;
  const details = [
    tests > 0 ? phrase({ en: `${tests} tests`, ru: `тестов: ${tests}` }) : "",
    config > 0 ? phrase({ en: `${config} config`, ru: `конфигураций: ${config}` }) : "",
    added > 0 ? phrase({ en: `+${added} new`, ru: `новых: +${added}` }) : "",
  ].filter(Boolean);
  note(
    [
      `${files.length} files · ${formatSize(bytes)} · ~${estimate.tokens.toLocaleString()} tokens · ${price}`,
      details.join(" · "),
      "",
      ...files.slice(0, 6).map((path) => `  ${path}`),
      ...(files.length > 6
        ? [phrase({ en: `  … and ${files.length - 6} more`, ru: `  … и ещё ${files.length - 6}` })]
        : []),
    ]
      .filter(Boolean)
      .join("\n"),
    phrase({ en: "Selected context", ru: "Выбранный контекст" }),
  );
}

function category(path: string, recommended: boolean): string {
  if (recommended) return "recommended";
  if (/(^|\/)(__tests__|tests?|specs?)(\/|\.|$)|\.(test|spec)\.[^.]+$/i.test(path)) return "tests";
  if (/(^|\/)(package\.json|bun\.lock|tsconfig[^/]*|biome\.json|\.github)(\/|$)/i.test(path))
    return "config";
  return "project";
}

function safePaths(paths: string[], sizes: Map<string, number>): string[] {
  return [...new Set(paths)].filter(
    (path) => sizes.has(path) && (sizes.get(path) ?? 0) <= MAX_FILE_BYTES,
  );
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KiB`;
}

function unwrap<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel(phrase({ en: "Repository discovery cancelled", ru: "Исследование отменено" }));
  process.exit(0);
}
