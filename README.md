# Spec Agent

[English](#english) | [Русский](#русский)

## English

A Bun and TypeScript CLI that turns a task description into a validated product
specification. The model cannot access the repository, write code, or make
missing product decisions on the user's behalf.

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
```

### Documentation

- [English documentation](docs/en/README.md)
- [How to write requests](docs/en/writing-requests.md)
- [Документация на русском](docs/ru/README.md)

## Русский

CLI-приложение на Bun и TypeScript, которое превращает описание задачи в
проверенную продуктовую спецификацию. Модель не получает доступ к репозиторию,
не пишет код и не принимает отсутствующие продуктовые решения за пользователя.

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
```

### Документация

- [Документация на русском](docs/ru/README.md)
- [Как составлять запросы](docs/ru/writing-requests.md)
- [English documentation](docs/en/README.md)
