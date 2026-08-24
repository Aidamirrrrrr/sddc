# Spec Agent

[English](#english) | [Русский](#русский)

## English

A Bun and TypeScript CLI that turns a task description into a validated product
specification. While drafting the specification, the model cannot access the
repository or make missing product decisions on the user's behalf. The agent
never writes implementation code.

After approval, a ready specification triggers a read-only, evidence-backed
repository discovery. The user confirms its searchable file selection and may
add project context before anything is sent to the model.

An accepted discovery is converted into a validated implementation task graph.
The agent asks about missing decisions and writes `plan.yaml` only after the
user explicitly accepts it. It still does not modify source code.

The result is stored in `.specs/<feature>/spec.yaml` inside the project from
which the agent is run after interactive approval. Non-interactive input writes
`spec.draft.yaml` instead.

### Quick Start

```bash
bun install
bun start -- "Add user registration"
```

Run all project checks:

```bash
bun run check
```

Configuration is loaded from `.env` and process environment variables:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://example.com/v1/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
```

### Documentation

- [English documentation](docs/en/README.md)
- [How to write requests](docs/en/writing-requests.md)
- [Документация на русском](docs/ru/README.md)

## Русский

CLI-приложение на Bun и TypeScript, которое превращает описание задачи в
проверенную продуктовую спецификацию. При подготовке спеки модель не получает
доступ к репозиторию и не принимает отсутствующие продуктовые решения за
пользователя. Агент не пишет код реализации.

После подтверждения готовой спеки запускается read-only исследование проекта с
файловыми evidence. Перед отправкой содержимого модели пользователь подтверждает
файлы через селектор с поиском и может добавить контекст проекта.

На основе принятого discovery агент составляет проверяемый граф задач реализации,
задаёт вопросы о недостающих решениях и сохраняет `plan.yaml` только после явного
подтверждения. Исходный код на этом этапе по-прежнему не изменяется.

Результат сохраняется в `.specs/<feature>/spec.yaml` внутри проекта, из которого
запущен агент, только после интерактивного подтверждения. Неинтерактивный запуск
сохраняет `spec.draft.yaml`.

### Быстрый старт

```bash
bun install
bun start -- "Добавить регистрацию пользователей"
```

Запуск всех проверок проекта:

```bash
bun run check
```

Конфигурация загружается из `.env` и переменных окружения:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://example.com/v1/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
```

### Документация

- [Документация на русском](docs/ru/README.md)
- [Как составлять запросы](docs/ru/writing-requests.md)
- [English documentation](docs/en/README.md)
