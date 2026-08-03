pub fn run_tool(name: &str, arguments: &str) -> String {
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
