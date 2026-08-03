pub fn tool_definitions() -> serde_json::Value {
    serde_json::json!([
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
    ])
}

fn parse_args(arguments: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(arguments).map_err(|e| format!("Ошибка парсинга аргументов: {e}"))
}

fn require_str<'a>(parsed: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    parsed[key]
        .as_str()
        .ok_or_else(|| format!("Аргумент {key} не передан"))
}

fn confirm(message: &str) -> bool {
    print!("{message} (y/n): ");
    let _ = std::io::Write::flush(&mut std::io::stdout());

    let mut input = String::new();
    if std::io::stdin().read_line(&mut input).is_err() {
        return false;
    }

    input.trim() == "y"
}

pub fn run_tool(name: &str, arguments: &str) -> String {
    match name {
        "read_file" => {
            let parsed = match parse_args(arguments) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let path = match require_str(&parsed, "path") {
                Ok(p) => p,
                Err(e) => return e,
            };

            match std::fs::read_to_string(path) {
                Ok(content) => content,
                Err(e) => format!("Не удалось прочитать файл: {e}"),
            }
        }
        "write_file" => {
            let parsed = match parse_args(arguments) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let path = match require_str(&parsed, "path") {
                Ok(p) => p,
                Err(e) => return e,
            };
            let content = match require_str(&parsed, "content") {
                Ok(c) => c,
                Err(e) => return e,
            };

            if !confirm(&format!("Разрешить запись в файл '{path}'?")) {
                return "Пользователь отклонил запись файла".to_string();
            }

            match std::fs::write(path, content) {
                Ok(()) => format!("Файл '{path}' успешно записан"),
                Err(e) => format!("Не удалось записать файл: {e}"),
            }
        }
        "list_dir" => {
            let parsed = match parse_args(arguments) {
                Ok(v) => v,
                Err(e) => return e,
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

                if entry.path().is_dir() {
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
            let parsed = match parse_args(arguments) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let command = match require_str(&parsed, "command") {
                Ok(c) => c,
                Err(e) => return e,
            };

            if !confirm(&format!("Разрешить выполнить команду '{command}'?"))
            {
                return "Пользователь отклонил выполнение команды".to_string();
            }

            let output = match std::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .output()
            {
                Ok(o) => o,
                Err(e) => return format!("Не удалось запустить команду: {e}"),
            };

            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            format!("stdout:\n{stdout}\nstderr:\n{stderr}")
        }
        "edit_file" => {
            let parsed = match parse_args(arguments) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let path = match require_str(&parsed, "path") {
                Ok(p) => p,
                Err(e) => return e,
            };
            let old_string = match require_str(&parsed, "old_string") {
                Ok(s) => s,
                Err(e) => return e,
            };
            let new_string = match require_str(&parsed, "new_string") {
                Ok(s) => s,
                Err(e) => return e,
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

            if !confirm(&format!("Разрешить редактирование файла '{path}'?"))
            {
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
            let parsed = match parse_args(arguments) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let path = match require_str(&parsed, "path") {
                Ok(p) => p,
                Err(e) => return e,
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
                let old_string = match require_str(edit, "old_string") {
                    Ok(s) => s,
                    Err(e) => return format!("Правка #{}: {e}", i + 1),
                };
                let new_string = match require_str(edit, "new_string") {
                    Ok(s) => s,
                    Err(e) => return format!("Правка #{}: {e}", i + 1),
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

            if !confirm(&format!(
                "Разрешить применить {} правок к файлу '{path}'?",
                edits.len()
            )) {
                return "Пользователь отклонил применение правок".to_string();
            }

            match std::fs::write(path, content) {
                Ok(()) => format!(
                    "Файл '{path}' успешно отредактирован ({} правок)",
                    edits.len()
                ),
                Err(e) => format!("Не удалось записать файл: {e}"),
            }
        }
        _ => format!("Неизвестный инструмент: {name}"),
    }
}
