# sddc

[English](#english) | [Русский](#русский)

## English

A Bun and TypeScript CLI that turns a task description into a validated product
specification. For project changes, the model reads only repository files first
approved by the user, so existing code facts can inform the specification. It
does not make missing product decisions on the user's behalf or write code while
requirements are unsettled.

For change requests, the user confirms a searchable repository file selection
before requirements are written. The same approved snapshots support the
requirements and the later evidence-backed project map.

An accepted project map is converted into a validated technical plan — the
approach, the changed contracts, and the data model — and then, as a separate
phase, into an executable task graph whose independent tasks are grouped into
dependency waves. The agent asks about missing decisions and writes `plan.yaml`
and `tasks.yaml` only after the user explicitly accepts each of them. A deterministic project policy limits file changes,
commands, network access, and sensitive operations. Accepted decisions and their
provenance are recorded separately. The agent still does not modify source code.

Implementation starts only after a separate confirmation. The user approves each
task diff, verification runs without a shell, and a failed task is rolled back.
Strict, normal, and trusted approval modes control interaction density; sensitive
permissions always require confirmation. Interrupted runs can be resumed safely.

Read-only questions about an existing project use a separate inquiry flow. The
user approves repository context, and sddc answers with file evidence
without creating a specification, plan, or source changes.

For project changes, sddc collects user-approved repository context before
writing the specification. Existing signatures and behavior are discovered from
code instead of being turned into questions for the user.

The interface language is selected explicitly. Model-authored documents follow
the request language. The terminal presents human-readable requirements, a project
map, and a work plan; YAML is kept only as an internal artifact in `.specs`.

The four review documents answer different questions:

- **Requirements** define what must change and how success will be checked.
- **Project map** shows where the related code, tests, conventions, and constraints live.
- **Technical plan** defines the approach, the changed contracts, and the data model.
- **Task graph** defines the file changes, dependency waves, and verification commands.

Stored artifacts are inputs, not history: edit `spec.yaml` and run
`sddc --recompile plan` to rebuild everything below it. Principles the
deterministic policy cannot express live in `.sddc/constitution.md`.

The result is stored in `.specs/<feature>/spec.yaml` inside the project from
which the agent is run after interactive approval. Non-interactive input writes
`spec.draft.yaml` instead.

### Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/sddc/master/install.sh | sh
sddc --init
```

Edit `~/.config/sddc/.env`, then run sddc inside the project it
should work on:

```bash
sddc "Add user registration"
```

Useful modes: `--dry-run` stops after the accepted task graph, `--recompile plan|tasks|execute` rebuilds a stored feature, `--plain` removes
decorative output, `--json` emits JSON Lines and implies `--no-input`, `--debug`
shows stack traces, and `--no-input` guarantees that no prompt will be opened.
Use `--lang en` or `--lang ru` to skip the language selector.

Process environment variables take precedence over the user configuration.
For development from source, run `bun install && bun run install:local`.

Configuration:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://example.com/v1/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
AI_MAX_OUTPUT_TOKENS=optional-output-cap-or-off
AI_REQUEST_TIMEOUT_SECONDS=optional-seconds
SDDC_LANG=en
SDDC_THEME=dark
```

Only the first three are required. `sddc --init` writes the whole list; the
[full documentation](docs/en/README.md#configuration) explains what each one bounds.

### Test-first (SDD Article III)

SDD states that no implementation is written before the test that covers it. `sddc` enforces this on
the task graph rather than asking a model to comply: with
`changes.require_test_before_implementation` on, a task changing behavioural source must depend on an
earlier task that writes a test covering the same requirement, and that test task's verification is
required to *fail* — a test that already passes asserts nothing.

The rule ships **off by default**, because a graph that never satisfies it only teaches people to
switch it off. Turn it on per project in `.sddc/policy.yaml`:

```yaml
version: 1
changes:
  require_test_before_implementation: true
```

### Documentation

- [English documentation](docs/en/README.md)
- [How to write requests](docs/en/writing-requests.md)
- [Документация на русском](docs/ru/README.md)

## Русский

CLI-приложение на Bun и TypeScript, которое превращает описание задачи в
проверенные требования. Модель читает только заранее разрешённые файлы и не
принимает отсутствующие продуктовые решения за пользователя. Пока требования
не согласованы, агент не пишет код реализации.

Перед спецификацией пользователь подтверждает файлы через селектор с поиском и
может добавить контекст проекта. Модель читает только разрешённый набор, поэтому
существующие технические факты попадают в спеку без лишних вопросов.

На основе принятой карты проекта агент составляет технический план — подход,
изменяемые контракты и модель данных, — а затем отдельной фазой выводит
исполняемый граф задач, где независимые задачи сгруппированы в волны
зависимостей. Агент задаёт вопросы о недостающих решениях и сохраняет
`plan.yaml` и `tasks.yaml` только после явного подтверждения каждого из них. Детерминированная политика проекта ограничивает изменения файлов,
команды, доступ к сети и чувствительные операции. Принятые решения и их источники
фиксируются отдельно. Исходный код на этом этапе по-прежнему не изменяется.

Реализация запускается только после отдельного подтверждения. Пользователь
принимает diff каждой задачи, проверки запускаются без shell, а неуспешная задача
откатывается.
Режимы strict, normal и trusted регулируют количество подтверждений, но
чувствительные permissions подтверждаются всегда. Прерванный запуск можно
безопасно продолжить.

Вопросы о существующем проекте обрабатываются отдельным read-only режимом.
Пользователь подтверждает контекст репозитория, после чего sddc отвечает
с файловыми evidence без создания спеки, плана или изменений кода.

Для изменений проекта sddc собирает подтверждённый пользователем контекст
до составления спецификации. Существующие сигнатуры и поведение читаются из кода,
а не превращаются в вопросы пользователю.

Язык интерфейса выбирается отдельно. Документы модели пишутся на языке запроса.
Терминал показывает требования, карту проекта и план работ в человекочитаемом
виде; YAML остаётся только внутренним артефактом в `.specs`.

Четыре документа отвечают на разные вопросы:

- **Требования**: что должно измениться и как принять результат.
- **Карта проекта**: где находятся связанный код, тесты, соглашения и ограничения.
- **Технический план**: какой подход, какие контракты и модель данных меняются.
- **Граф задач**: какие файлы менять, какими волнами и какими командами проверять.

Сохранённые артефакты — это входные данные, а не история: правьте `spec.yaml` и
запускайте `sddc --recompile plan`, чтобы пересобрать всё, что ниже. Принципы,
которые не выражает детерминированная политика, живут в `.sddc/constitution.md`.

Результат сохраняется в `.specs/<feature>/spec.yaml` внутри проекта, из которого
запущен агент, только после интерактивного подтверждения. Неинтерактивный запуск
сохраняет `spec.draft.yaml`.

### Быстрый старт

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/sddc/master/install.sh | sh
sddc --init
```

Заполните `~/.config/sddc/.env`, затем запустите sddc из проекта,
над которым он должен работать:

```bash
sddc "Добавить регистрацию пользователей"
```

Режимы запуска: `--dry-run` останавливается после принятого графа задач, `--recompile plan|tasks|execute` пересобирает сохранённую фичу, `--plain`
убирает декоративный вывод, `--json` выдаёт JSON Lines и включает `--no-input`,
`--debug` показывает stack trace, а `--no-input` гарантирует отсутствие prompts.
Флаги `--lang en` и `--lang ru` позволяют пропустить выбор языка.

Переменные окружения имеют приоритет над пользовательским конфигом. Для
локальной установки из исходников выполните `bun install && bun run install:local`.

Конфигурация:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://example.com/v1/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
AI_MAX_OUTPUT_TOKENS=optional-output-cap-or-off
AI_REQUEST_TIMEOUT_SECONDS=optional-seconds
SDDC_LANG=ru
SDDC_THEME=dark
```

Обязательны только первые три. `sddc --init` записывает весь список; что именно
ограничивает каждая переменная, описано в
[документации](docs/ru/README.md#конфигурация).

### Сначала тест (Article III в SDD)

SDD требует, чтобы реализация не появлялась раньше покрывающего её теста. `sddc` проверяет это по
графу задач, а не просьбой к модели: при включённом
`changes.require_test_before_implementation` задача, меняющая исходный код, обязана зависеть от более
ранней задачи с тестом на то же требование, и проверка этой тестовой задачи обязана **упасть** — тест,
который проходит сразу, ничего не утверждает.

По умолчанию правило **выключено**: граф, который никогда его не выполняет, научил бы только тому, как
его отключать. Включается в `.sddc/policy.yaml` для конкретного проекта:

```yaml
version: 1
changes:
  require_test_before_implementation: true
```

### Документация

- [Документация на русском](docs/ru/README.md)
- [Как составлять запросы](docs/ru/writing-requests.md)
- [English documentation](docs/en/README.md)
