# sddc

**Every decision is written down before the code is, and you can refuse each one.**

[English](#english) | [Русский](#русский)

---

## English

A coding agent decides a hundred things on the way from your sentence to a diff.
Which requirements it inferred. What it assumed you meant. Which file it chose to
touch. You see the diff. You do not see the decisions.

`sddc` puts them in files first. Requirements, a project map, a technical plan, a
task graph — each one shown, each one refusable, each one on disk afterwards. Only
then does anything get written, one task at a time, inside a scope you approved.

It is slower than asking an agent to just do it. That is the whole point.

### The loop that makes it yours

The artifacts are **inputs, not history**. Change one and everything below it
rebuilds:

```bash
sddc "Let a note be archived so archived notes are hidden from the default list"
# → .specs/archive-note/{spec,discovery,plan,tasks}.yaml, each one accepted by you

vim .specs/archive-note/spec.yaml     # add a requirement, reword an acceptance criterion
sddc --recompile plan                  # the plan and the task graph are derived again
```

No agent transcript can do that. A conversation is gone when it ends; a
specification you can edit and recompile is a thing you own.

### What the artifacts actually look like

Real output, from the eval corpus in this repository:

```yaml
# .specs/archive-note/spec.yaml
requirements:
  - { id: R1, statement: A note can be archived. }
  - { id: R2, statement: Archived notes are hidden from the default list. }
acceptance:
  - { id: A1, verifies: [R1], statement: "When a note is archived, the note is marked as archived." }
  - { id: A2, verifies: [R2], statement: "When notes are listed, archived notes are not included." }
```

Every requirement is traced to an acceptance criterion, every criterion to
**exactly one** task, and every task to the files it may touch. So a failing
criterion names the task that owns it. `decisions.yaml` records where each choice
came from: you, evidence in a file, or the agent's own inference.

### What is guaranteed, and what is not

This distinction matters more than any feature, so it is on the front page.

**Checked by code, not by asking a model.** These cannot be argued with:

- Dependency waves are computed from the graph, never claimed by the model
- Every requirement and criterion is covered, and coverage is a partition
- Two tasks writing one file must be ordered; cycles are rejected
- Writes are confined to the files a task declared, refused at the moment of the write
- Commands come from a policy allowlist and run without a shell in a sanitized environment
- File contents are matched by SHA-256 before and after; every task is fully reversible
- The whole run has a ceiling on model calls

**Judged by a model, gated by code.** Thirty-eight review checks across the four
phases decide whether an artifact is *good*. The verdict is mechanical — one
failed check refuses the artifact, and a concern must name the check it belongs
to — but the judgement itself is a model's. It is a second opinion with
deterministic gates, not a proof.

**Heuristic, and occasionally wrong.** What counts as a test file, what counts as
behavioural source, how many tokens a file costs. Conservative by design, but a
project with an unusual layout can be judged badly.

### Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/sddc/master/install.sh | sh
sddc --init
```

Fill in `~/.config/sddc/.env`, then run it inside the project it should work on:

```bash
sddc "Add user registration"
```

Any OpenAI-compatible endpoint works:

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

### Implementation

Implementation starts only after a separate confirmation. Each task runs as a loop
that can read files, search the project, run diagnostic commands and write — inside
the scope that task declared, with the host checking every move. When it finishes,
the host runs the task's verification, a read-only reviewer looks at what actually
ran, and you approve the diff. A failed task is rolled back to the byte, including
directories it created.

Three approval modes control how often you are asked. Sensitive permissions —
dependencies, configuration, migrations, network — are confirmed in every mode,
including `--yes`.

### Test-first, enforced on the graph

SDD's Article III says no implementation before the test that covers it. `sddc`
checks this on the task graph rather than asking a model to comply: a task changing
behavioural source must depend on an *earlier* task that writes a test covering the
same requirement, and that test task's verification is required to **fail**. A test
that passes before its implementation exists asserts nothing.

Off by default, because a rule that fails every run only teaches people to switch it
off. Turn it on per project in `.sddc/policy.yaml`:

```yaml
version: 1
changes:
  require_test_before_implementation: true
```

### Modes

`--dry-run` stops after the accepted task graph · `--recompile plan|tasks|execute`
rebuilds a stored feature · `--yes` implements without stopping at each diff ·
`--analyze` reports drift between artifacts · `--eval` scores the corpus offline ·
`--plain` removes decoration · `--json` emits JSON Lines · `--no-input` guarantees no
prompt · `--lang en|ru` skips the language selector.

### Status

Early. The pipeline is covered by 384 tests and an offline eval corpus, and the
implementation loop has not yet been exercised against a live model end to end.
Treat it accordingly.

### Documentation

- [English documentation](docs/en/README.md)
- [How to write requests](docs/en/writing-requests.md)
- [Документация на русском](docs/ru/README.md)

### Licence

Copyright (C) 2026 Aidamir. Licensed under the
[GNU Affero General Public License v3.0](LICENSE).

Use it, change it, ship it. If you run a modified version as a network service, the
people using that service are entitled to its source.

---

## Русский

**Каждое решение записывается раньше кода, и каждое можно отклонить.**

По дороге от вашей фразы до диффа агент принимает сотню решений. Какие требования он
вывел. Что он решил, что вы имели в виду. Какой файл выбрал трогать. Дифф вы видите.
Решения — нет.

`sddc` сначала кладёт их в файлы. Требования, карта проекта, технический план, граф
задач — каждый показывается, каждый можно отклонить, каждый остаётся на диске. И
только потом что-то пишется, по одной задаче, в области, которую вы разрешили.

Это медленнее, чем попросить агента просто сделать. В этом и смысл.

### Цикл, который делает проект вашим

Артефакты — это **входные данные, а не история**. Меняете один — всё, что ниже,
пересобирается:

```bash
sddc "Добавить архивацию заметки, чтобы архивные не попадали в список по умолчанию"
# → .specs/archive-note/{spec,discovery,plan,tasks}.yaml, каждый принят вами

vim .specs/archive-note/spec.yaml     # дописать требование, переформулировать критерий
sddc --recompile plan                  # план и граф задач выводятся заново
```

Транскрипт диалога так не умеет. Разговор кончается вместе с сессией; спецификация,
которую можно править и пересобирать, — это то, чем вы владеете.

### Как выглядят артефакты

Настоящий вывод, из корпуса eval в этом репозитории:

```yaml
# .specs/archive-note/spec.yaml
requirements:
  - { id: R1, statement: A note can be archived. }
  - { id: R2, statement: Archived notes are hidden from the default list. }
acceptance:
  - { id: A1, verifies: [R1], statement: "When a note is archived, the note is marked as archived." }
  - { id: A2, verifies: [R2], statement: "When notes are listed, archived notes are not included." }
```

Каждое требование прослежено до критерия приёмки, каждый критерий — до **ровно
одной** задачи, каждая задача — до файлов, которые ей позволено трогать. Поэтому
упавший критерий называет задачу, которая им владеет. `decisions.yaml` записывает,
откуда взялся каждый выбор: от вас, из свидетельства в файле или из домысла агента.

### Что гарантировано, а что нет

Это различие важнее любой функции, поэтому оно на первой странице.

**Проверяется кодом, а не просьбой к модели.** С этим не поспорить:

- Волны зависимостей вычисляются из графа, а не заявляются моделью
- Все требования и критерии покрыты, и покрытие — это разбиение
- Две задачи, пишущие в один файл, обязаны быть упорядочены; циклы отклоняются
- Запись ограничена файлами задачи и отсекается в момент записи
- Команды берутся из списка политики и запускаются без shell в очищенном окружении
- Содержимое файлов сверяется по SHA-256 до и после; любая задача полностью обратима
- У всего прогона есть потолок вызовов модели

**Оценивается моделью, ворота — код.** Тридцать восемь проверок по четырём фазам
решают, *хорош* ли артефакт. Вердикт механический — одна непройденная проверка
отклоняет артефакт, а возражение обязано быть привязано к конкретной проверке, — но
само суждение выносит модель. Это второе мнение с детерминированными воротами, а не
доказательство.

**Эвристики, которые иногда ошибаются.** Что считать тестовым файлом, что считать
поведенческим исходником, во сколько токенов обойдётся файл. Написаны консервативно,
но проект с непривычной раскладкой может быть оценён неверно.

### Быстрый старт

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/sddc/master/install.sh | sh
sddc --init
```

Заполните `~/.config/sddc/.env` и запустите из проекта, над которым он должен работать:

```bash
sddc "Добавить регистрацию пользователей"
```

Подойдёт любой OpenAI-совместимый endpoint:

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
ограничивает каждая переменная, описано в [документации](docs/ru/README.md#конфигурация).

### Реализация

Реализация запускается только по отдельному подтверждению. Каждая задача работает
циклом, который может читать файлы, искать по проекту, запускать диагностические
команды и писать — внутри объявленной ею области, и хост проверяет каждый ход. Когда
цикл заканчивает, хост запускает проверки задачи, read-only ревьюер смотрит на то,
что реально выполнилось, а вы принимаете дифф. Упавшая задача откатывается побайтово,
вместе с каталогами, которые создала.

Три режима подтверждений регулируют, как часто вас спрашивают. Чувствительные
разрешения — зависимости, конфигурация, миграции, сеть — подтверждаются в любом
режиме, включая `--yes`.

### Сначала тест, проверено по графу

Article III в SDD требует, чтобы реализация не появлялась раньше покрывающего её
теста. `sddc` проверяет это по графу задач, а не просьбой к модели: задача, меняющая
исходный код, обязана зависеть от **более ранней** задачи с тестом на то же
требование, и проверка этой тестовой задачи обязана **упасть**. Тест, проходящий до
появления реализации, ничего не утверждает.

По умолчанию выключено: правило, которое падает на каждом прогоне, учит только тому,
как его отключать. Включается в `.sddc/policy.yaml` для конкретного проекта:

```yaml
version: 1
changes:
  require_test_before_implementation: true
```

### Режимы

`--dry-run` останавливается после принятого графа · `--recompile plan|tasks|execute`
пересобирает сохранённую фичу · `--yes` реализует без остановки на каждом диффе ·
`--analyze` показывает расхождения между артефактами · `--eval` прогоняет корпус
офлайн · `--plain` убирает оформление · `--json` выдаёт JSON Lines · `--no-input`
гарантирует отсутствие prompts · `--lang en|ru` пропускает выбор языка.

### Статус

Ранний. Конвейер покрыт 384 тестами и офлайн-корпусом eval, а цикл реализации ещё ни
разу не отработал против живой модели от начала до конца. Относитесь соответственно.

### Документация

- [Документация на русском](docs/ru/README.md)
- [Как составлять запросы](docs/ru/writing-requests.md)
- [English documentation](docs/en/README.md)

### Лицензия

Copyright (C) 2026 Aidamir. Распространяется по
[GNU Affero General Public License v3.0](LICENSE).

Пользуйтесь, изменяйте, распространяйте. Если вы запускаете изменённую версию как
сетевой сервис — пользователи этого сервиса имеют право на её исходный код.
