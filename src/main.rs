#[derive(serde::Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(serde::Deserialize)]
struct Choice {
    message: Message,
}

#[derive(serde::Deserialize)]
struct Message {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(serde::Deserialize)]
struct ToolCall {
    id: String,
    function: FunctionCall,
}

#[derive(serde::Deserialize)]
struct FunctionCall {
    name: String,
    arguments: String,
}

fn run_tool(name: &str, arguments: &str) -> String {
    match name {
        "read_file" => {
            let parsed: serde_json::Value = match serde_json::from_str(arguments) {
                Ok(v) => v,
                Err(e) => return format!("Ошибка парсинга аргументов: {e}"),
            };

            let path = match parsed["path"].as_str() {
                Some(p) => p,
                None => return "Аргумент path не передан".to_string(),
            };

            match std::fs::read_to_string(path) {
                Ok(content) => content,
                Err(e) => format!("Не удалось прочитать файл: {e}"),
            }
        }
        "write_file" => {
            let parsed: serde_json::Value = match serde_json::from_str(arguments) {
                Ok(v) => v,
                Err(e) => return format!("Ошибка парсинга аргументов: {e}"),
            };

            let path = match parsed["path"].as_str() {
                Some(p) => p,
                None => return "Аргумент path не передан".to_string(),
            };

            let content = match parsed["content"].as_str() {
                Some(c) => c,
                None => return "Аргумент content не передан".to_string(),
            };

            print!("Разрешить запись в файл '{path}'? (y/n): ");
            let _ = std::io::Write::flush(&mut std::io::stdout());

            let mut confirm = String::new();
            if std::io::stdin().read_line(&mut confirm).is_err() {
                return "Не удалось прочитать подтверждение от пользователя".to_string();
            }

            if confirm.trim() != "y" {
                return "Пользователь отклонил запись файла".to_string();
            }

            match std::fs::write(path, content) {
                Ok(()) => format!("Файл '{path}' успешно записан"),
                Err(e) => format!("Не удалось записать файл: {e}"),
            }
        }
        "list_dir" => {
            let parsed: serde_json::Value = match serde_json::from_str(arguments) {
                Ok(v) => v,
                Err(e) => return format!("Ошибка парсинга аргументов: {e}"),
            };

            let path = parsed["path"].as_str().unwrap_or(".");

            let entries = match std::fs::read_dir(path) {
                Ok(entries) => entries,
                Err(e) => return format!("Не удалось прочитать папку: {e}"),
            };

            let mut names = Vec::new();
            for entry in entries {
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => return format!("Ошибка чтения элемента папки: {e}"),
                };

                let file_name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.path().is_dir();

                if is_dir {
                    names.push(format!("{file_name}/"));
                } else {
                    names.push(file_name);
                }
            }

            if names.is_empty() {
                "Папка пуста".to_string()
            } else {
                names.join("\n")
            }
        }
        "run_command" => {
            let parsed: serde_json::Value = match serde_json::from_str(arguments) {
                Ok(v) => v,
                Err(e) => return format!("Ошибка парсинга аргументов: {e}"),
            };

            let command = match parsed["command"].as_str() {
                Some(c) => c,
                None => return "Аргумент command не передан".to_string(),
            };

            print!("Разрешить выполнить команду '{command}'? (y/n): ");
            let _ = std::io::Write::flush(&mut std::io::stdout());

            let mut confirm = String::new();
            if std::io::stdin().read_line(&mut confirm).is_err() {
                return "Не удалось прочитать подтверждение от пользователя".to_string();
            }

            if confirm.trim() != "y" {
                return "Пользователь отклонил выполнение команды".to_string();
            }

            let output = match std::process::Command::new("sh").arg("-c").arg(command).output() {
                Ok(o) => o,
                Err(e) => return format!("Не удалось запустить команду: {e}"),
            };

            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            format!("stdout:\n{stdout}\nstderr:\n{stderr}")
        }
        "edit_file" => {
            let parsed: serde_json::Value = match serde_json::from_str(arguments) {
                Ok(v) => v,
                Err(e) => return format!("Ошибка парсинга аргументов: {e}"),
            };

            let path = match parsed["path"].as_str() {
                Some(p) => p,
                None => return "Аргумент path не передан".to_string(),
            };

            let old_string = match parsed["old_string"].as_str() {
                Some(s) => s,
                None => return "Аргумент old_string не передан".to_string(),
            };

            let new_string = match parsed["new_string"].as_str() {
                Some(s) => s,
                None => return "Аргумент new_string не передан".to_string(),
            };

            let replace_all = parsed["replace_all"].as_bool().unwrap_or(false);

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => return format!("Не удалось прочитать файл: {e}"),
            };

            let occurrences = content.matches(old_string).count();

            if occurrences == 0 {
                return format!("old_string не найден в файле '{path}'");
            }

            if occurrences > 1 && !replace_all {
                return format!(
                    "old_string встречается {occurrences} раз(а) в файле '{path}' — сделай его уникальным, либо передай replace_all: true"
                );
            }

            print!("Разрешить редактирование файла '{path}'? (y/n): ");
            let _ = std::io::Write::flush(&mut std::io::stdout());

            let mut confirm = String::new();
            if std::io::stdin().read_line(&mut confirm).is_err() {
                return "Не удалось прочитать подтверждение от пользователя".to_string();
            }

            if confirm.trim() != "y" {
                return "Пользователь отклонил редактирование файла".to_string();
            }

            let new_content = if replace_all {
                content.replace(old_string, new_string)
            } else {
                content.replacen(old_string, new_string, 1)
            };

            match std::fs::write(path, new_content) {
                Ok(()) => format!("Файл '{path}' успешно отредактирован"),
                Err(e) => format!("Не удалось записать файл: {e}"),
            }
        }
        "multi_edit_file" => {
            let parsed: serde_json::Value = match serde_json::from_str(arguments) {
                Ok(v) => v,
                Err(e) => return format!("Ошибка парсинга аргументов: {e}"),
            };

            let path = match parsed["path"].as_str() {
                Some(p) => p,
                None => return "Аргумент path не передан".to_string(),
            };

            let edits = match parsed["edits"].as_array() {
                Some(e) => e,
                None => return "Аргумент edits не передан или не является массивом".to_string(),
            };

            let mut content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => return format!("Не удалось прочитать файл: {e}"),
            };

            for (i, edit) in edits.iter().enumerate() {
                let old_string = match edit["old_string"].as_str() {
                    Some(s) => s,
                    None => return format!("В правке #{} не передан old_string", i + 1),
                };

                let new_string = match edit["new_string"].as_str() {
                    Some(s) => s,
                    None => return format!("В правке #{} не передан new_string", i + 1),
                };

                let occurrences = content.matches(old_string).count();

                if occurrences == 0 {
                    return format!(
                        "Правка #{}: old_string не найден в файле (после предыдущих правок)",
                        i + 1
                    );
                }

                if occurrences > 1 {
                    return format!(
                        "Правка #{}: old_string встречается {} раз(а) — сделай его уникальным",
                        i + 1,
                        occurrences
                    );
                }

                content = content.replacen(old_string, new_string, 1);
            }

            print!(
                "Разрешить применить {} правок к файлу '{path}'? (y/n): ",
                edits.len()
            );
            let _ = std::io::Write::flush(&mut std::io::stdout());

            let mut confirm = String::new();
            if std::io::stdin().read_line(&mut confirm).is_err() {
                return "Не удалось прочитать подтверждение от пользователя".to_string();
            }

            if confirm.trim() != "y" {
                return "Пользователь отклонил применение правок".to_string();
            }

            match std::fs::write(path, content) {
                Ok(()) => format!("Файл '{path}' успешно отредактирован ({} правок)", edits.len()),
                Err(e) => format!("Не удалось записать файл: {e}"),
            }
        }
        _ => format!("Неизвестный инструмент: {name}"),
    }
}

const API_URL: &str = "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/57453037-879f-4306-aa42-0fe9b1696bc6/v1/chat/completions";

async fn call_model(
    client: &reqwest::Client,
    token: &str,
    history: &[serde_json::Value],
) -> Result<ChatResponse, Box<dyn std::error::Error>> {
    let response = client
        .post(API_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-5-nano",
            "messages": history,
            "temperature": 0.7,
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "description": "Прочитать содержимое текстового файла с диска по пути",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Путь к файлу"
                                }
                            },
                            "required": ["path"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "description": "Записать (создать или перезаписать целиком) текстовый файл на диске. Для уже существующего файла, когда нужно изменить только часть содержимого, предпочитай edit_file или multi_edit_file — так меньше риск случайно затереть остальное",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Путь к файлу"
                                },
                                "content": {
                                    "type": "string",
                                    "description": "Содержимое, которое нужно записать в файл"
                                }
                            },
                            "required": ["path", "content"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "list_dir",
                        "description": "Показать список файлов и папок внутри указанной директории",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Путь к папке (по умолчанию текущая директория)"
                                }
                            },
                            "required": []
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "run_command",
                        "description": "Выполнить shell-команду и вернуть её вывод",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "command": {
                                    "type": "string",
                                    "description": "Команда для выполнения в shell"
                                }
                            },
                            "required": ["command"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "edit_file",
                        "description": "Заменить точное вхождение old_string на new_string в уже существующем файле — предпочтительнее write_file для точечных правок. old_string должен быть уникальным в файле, иначе используй replace_all: true. Если нужно сделать несколько правок в одном файле за раз — используй multi_edit_file вместо повторных вызовов edit_file",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Путь к файлу"
                                },
                                "old_string": {
                                    "type": "string",
                                    "description": "Точный текст, который нужно найти и заменить"
                                },
                                "new_string": {
                                    "type": "string",
                                    "description": "Текст, на который нужно заменить"
                                },
                                "replace_all": {
                                    "type": "boolean",
                                    "description": "Заменить все вхождения, а не только первое (по умолчанию false)"
                                }
                            },
                            "required": ["path", "old_string", "new_string"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "multi_edit_file",
                        "description": "Применить несколько последовательных замен old_string -> new_string к одному файлу за один вызов. Каждый old_string должен быть уникальным в файле на момент своей правки",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Путь к файлу"
                                },
                                "edits": {
                                    "type": "array",
                                    "description": "Список правок, применяются по порядку",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "old_string": { "type": "string" },
                                            "new_string": { "type": "string" }
                                        },
                                        "required": ["old_string", "new_string"]
                                    }
                                }
                            },
                            "required": ["path", "edits"]
                        }
                    }
                }
            ]
        }))
        .send()
        .await?;

    let response_text = response.text().await?;

    match serde_json::from_str::<ChatResponse>(&response_text) {
        Ok(parsed) => Ok(parsed),
        Err(e) => {
            Err(format!("Не удалось разобрать ответ API: {e}. Сырой ответ: {response_text}").into())
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let token = std::env::var("AI_API_TOKEN").expect("AI_API_TOKEN не найден — проверь .env");
    let client = reqwest::Client::new();
    let mut history: Vec<serde_json::Value> = Vec::new();

    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "неизвестно".to_string());

    history.push(serde_json::json!({
        "role": "system",
        "content": format!(
            "Ты — коддинг-агент, работающий в терминале. Текущая рабочая директория: {cwd}.\n\
             Перед тем как что-то менять на диске или выполнять команды, кратко объясняй, что и зачем собираешься \
             делать. Отвечай на русском языке, кратко и по делу."
        )
    }));

    loop {
        print!("> ");
        std::io::Write::flush(&mut std::io::stdout())?;

        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        let input = input.trim();

        if input == "exit" {
            break;
        }

        if input.is_empty() {
            continue;
        }

        history.push(serde_json::json!({
            "role": "user",
            "content": input
        }));

        loop {
            let parsed = call_model(&client, &token, &history).await?;

            let Some(choice) = parsed.choices.first() else {
                println!("Модель не вернула ответ");
                break;
            };

            if let Some(tool_calls) = &choice.message.tool_calls {
                history.push(serde_json::json!({
                    "role": "assistant",
                    "content": serde_json::Value::Null,
                    "tool_calls": tool_calls.iter().map(|c| serde_json::json!({
                        "id": c.id,
                        "type": "function",
                        "function": {
                            "name": c.function.name,
                            "arguments": c.function.arguments
                        }
                    })).collect::<Vec<_>>()
                }));

                for call in tool_calls {
                    println!(
                        "[выполняю: {} {}]",
                        call.function.name, call.function.arguments
                    );
                    let result = run_tool(&call.function.name, &call.function.arguments);

                    history.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": result
                    }));
                }
            } else {
                let text = choice.message.content.clone().unwrap_or_default();
                println!("{text}");
                history.push(serde_json::json!({
                    "role": "assistant",
                    "content": text
                }));
                break;
            }
        }
    }

    Ok(())
}
