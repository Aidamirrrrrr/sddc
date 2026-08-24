# Spec Agent

CLI-приложение на Bun и TypeScript, которое превращает описание задачи в
проверенную продуктовую спецификацию. Модель не получает доступ к репозиторию,
не пишет код и не принимает отсутствующие продуктовые решения за пользователя.

Результат сохраняется в `.specs/<feature>/spec.yaml` внутри проекта, из которого
запущен агент.

## Быстрый старт

```bash
bun install
bun start -- "Добавить регистрацию пользователей"
```

Проверка проекта:

```bash
bun run check
```

Конфигурация загружается из `.env` и переменных окружения:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://example.com/v1/
AI_MODEL=model-id
```

## Документация

- [Документация на русском](docs/ru/README.md)
- [Как составлять запросы](docs/ru/writing-requests.md)
- [English documentation](docs/en/README.md)
- [How to write requests](docs/en/writing-requests.md)
