# Codekeeper

[English](#english) | [Русский](#русский)

## English

A Bun and TypeScript CLI that turns a task description into a validated product
specification. For project changes, the model reads only repository files first
approved by the user, so existing code facts can inform the specification. It
does not make missing product decisions on the user's behalf or write code while
requirements are unsettled.

For change requests, the user confirms a searchable repository file selection
before specification. The same approved snapshots support the specification and
the later evidence-backed discovery.

An accepted discovery is converted into a validated implementation task graph.
The agent asks about missing decisions and writes `plan.yaml` only after the
user explicitly accepts it. A deterministic project policy limits file changes,
commands, network access, and sensitive operations. Accepted decisions and their
provenance are recorded separately. The agent still does not modify source code.

Implementation starts only after a separate confirmation. The user approves each
task diff, verification runs without a shell, and a failed task is rolled back.
Strict, normal, and trusted approval modes control interaction density; sensitive
permissions always require confirmation. Interrupted runs can be resumed safely.

Read-only questions about an existing project use a separate inquiry flow. The
user approves repository context, and Codekeeper answers with file evidence
without creating a specification, plan, or source changes.

For project changes, Codekeeper collects user-approved repository context before
writing the specification. Existing signatures and behavior are discovered from
code instead of being turned into questions for the user.

The interactive terminal follows the request language, shows progress for model
stages, and presents compact context, specification, discovery, and plan summaries
as one guided flow. Full YAML remains available as an explicit review action.

The result is stored in `.specs/<feature>/spec.yaml` inside the project from
which the agent is run after interactive approval. Non-interactive input writes
`spec.draft.yaml` instead.

### Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/codekeeper/master/install.sh | sh
codekeeper --init
```

Edit `~/.config/codekeeper/.env`, then run Codekeeper inside the project it
should work on:

```bash
codekeeper "Add user registration"
```

Useful modes: `--dry-run` stops after the accepted plan, `--plain` removes
decorative output, `--json` emits JSON Lines and implies `--no-input`, `--debug`
shows stack traces, and `--no-input` guarantees that no prompt will be opened.

Process environment variables take precedence over the user configuration.
For development from source, run `bun install && bun run install:local`.

Configuration:

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
пользователя. Пока требования не согласованы, агент не пишет код реализации.

Перед спецификацией пользователь подтверждает файлы через селектор с поиском и
может добавить контекст проекта. Модель читает только разрешённый набор, поэтому
существующие технические факты попадают в спеку без лишних вопросов.

На основе принятого discovery агент составляет проверяемый граф задач реализации,
задаёт вопросы о недостающих решениях и сохраняет `plan.yaml` только после явного
подтверждения. Детерминированная политика проекта ограничивает изменения файлов,
команды, доступ к сети и чувствительные операции. Принятые решения и их источники
фиксируются отдельно. Исходный код на этом этапе по-прежнему не изменяется.

Реализация запускается только после отдельного подтверждения. Пользователь
принимает diff каждой задачи, проверки запускаются без shell, а неуспешная задача
откатывается.
Режимы strict, normal и trusted регулируют количество подтверждений, но
чувствительные permissions подтверждаются всегда. Прерванный запуск можно
безопасно продолжить.

Вопросы о существующем проекте обрабатываются отдельным read-only режимом.
Пользователь подтверждает контекст репозитория, после чего Codekeeper отвечает
с файловыми evidence без создания спеки, плана или изменений кода.

Для изменений проекта Codekeeper собирает подтверждённый пользователем контекст
до составления спецификации. Существующие сигнатуры и поведение читаются из кода,
а не превращаются в вопросы пользователю.

Интерактивный терминал следует языку запроса, показывает прогресс модельных
этапов и объединяет контекст, проверки и сохранённые артефакты в цельный сценарий.
По умолчанию показываются компактные итоги; полный YAML открывается отдельным
действием при проверке.

Результат сохраняется в `.specs/<feature>/spec.yaml` внутри проекта, из которого
запущен агент, только после интерактивного подтверждения. Неинтерактивный запуск
сохраняет `spec.draft.yaml`.

### Быстрый старт

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/codekeeper/master/install.sh | sh
codekeeper --init
```

Заполните `~/.config/codekeeper/.env`, затем запустите Codekeeper из проекта,
над которым он должен работать:

```bash
codekeeper "Добавить регистрацию пользователей"
```

Режимы запуска: `--dry-run` останавливается после принятого плана, `--plain`
убирает декоративный вывод, `--json` выдаёт JSON Lines и включает `--no-input`,
`--debug` показывает stack trace, а `--no-input` гарантирует отсутствие prompts.

Переменные окружения имеют приоритет над пользовательским конфигом. Для
локальной установки из исходников выполните `bun install && bun run install:local`.

Конфигурация:

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
