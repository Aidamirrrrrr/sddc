use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn tool_definitions() -> Value {
    serde_json::json!([
        {"type":"function","function":{"name":"inspect","description":"Исследовать проект без изменений: прочитать файл, показать директорию или найти текст в файлах","parameters":{"type":"object","properties":{"operation":{"type":"string","enum":["read","list","search"]},"path":{"type":"string","description":"Путь к файлу или директории (по умолчанию .)"},"query":{"type":"string","description":"Текст для search"},"start_line":{"type":"integer","minimum":1},"end_line":{"type":"integer","minimum":1}},"required":["operation"]}}},
        {"type":"function","function":{"name":"modify","description":"Создать, изменить или удалить файл. Для точечных изменений предпочитай replace или patch","parameters":{"type":"object","properties":{"operation":{"type":"string","enum":["write","replace","patch","delete"]},"path":{"type":"string"},"content":{"type":"string","description":"Полное содержимое для write"},"old_string":{"type":"string"},"new_string":{"type":"string"},"replace_all":{"type":"boolean"},"edits":{"type":"array","description":"Последовательность точных замен для атомарного patch","items":{"type":"object","properties":{"old_string":{"type":"string"},"new_string":{"type":"string"}},"required":["old_string","new_string"]}}},"required":["operation","path"]}}},
        {"type":"function","function":{"name":"execute","description":"Выполнить shell-команду, например тесты, typecheck или lint, и вернуть stdout, stderr и код завершения","parameters":{"type":"object","properties":{"command":{"type":"string"},"cwd":{"type":"string","description":"Рабочая директория команды"}},"required":["command"]}}}
    ])
}

fn parse_args(arguments: &str) -> Result<Value, String> {
    serde_json::from_str(arguments).map_err(|e| format!("Ошибка парсинга аргументов: {e}"))
}

fn require_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("Аргумент {key} не передан"))
}

fn confirm(message: &str) -> bool {
    print!("{message} (y/n): ");
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).is_ok() && input.trim() == "y"
}

pub fn run_tool(name: &str, arguments: &str) -> String {
    let args = match parse_args(arguments) {
        Ok(value) => value,
        Err(error) => return error,
    };
    match name {
        "inspect" => inspect(&args),
        "modify" => modify(&args),
        "execute" => execute(&args),
        _ => format!("Неизвестный инструмент: {name}"),
    }
}

fn inspect(args: &Value) -> String {
    match require_str(args, "operation") {
        Ok("read") => inspect_read(args),
        Ok("list") => inspect_list(args),
        Ok("search") => inspect_search(args),
        Ok(operation) => format!("Неизвестная операция inspect: {operation}"),
        Err(error) => error,
    }
}

fn inspect_read(args: &Value) -> String {
    let path = match require_str(args, "path") {
        Ok(path) => path,
        Err(error) => return error,
    };
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => return format!("Не удалось прочитать файл: {error}"),
    };
    let start = args["start_line"].as_u64().unwrap_or(1) as usize;
    let end = args["end_line"].as_u64().map(|line| line as usize);
    content
        .lines()
        .enumerate()
        .filter(|(index, _)| index + 1 >= start && end.is_none_or(|end| *index < end))
        .map(|(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn inspect_list(args: &Value) -> String {
    let path = args["path"].as_str().unwrap_or(".");
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => return format!("Не удалось прочитать папку: {error}"),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => return format!("Ошибка чтения элемента папки: {error}"),
        };
        let mut name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() {
            name.push('/');
        }
        names.push(name);
    }
    names.sort();
    if names.is_empty() {
        "Папка пуста".to_string()
    } else {
        names.join("\n")
    }
}

fn inspect_search(args: &Value) -> String {
    let query = match require_str(args, "query") {
        Ok(query) => query,
        Err(error) => return error,
    };
    let root = Path::new(args["path"].as_str().unwrap_or("."));
    let mut files = Vec::new();
    if let Err(error) = collect_files(root, &mut files) {
        return format!("Не удалось выполнить поиск: {error}");
    }
    let mut matches = Vec::new();
    for path in files {
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if line.contains(query) {
                matches.push(format!("{}:{}:{}", path.display(), index + 1, line));
            }
        }
    }
    if matches.is_empty() {
        "Совпадений не найдено".to_string()
    } else {
        matches.join("\n")
    }
}

fn collect_files(path: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if path.is_file() {
        files.push(path.to_path_buf());
        return Ok(());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            let name = entry.file_name();
            if name != ".git" && name != "target" {
                collect_files(&entry_path, files)?;
            }
        } else if entry_path.is_file() {
            files.push(entry_path);
        }
    }
    Ok(())
}

fn modify(args: &Value) -> String {
    let operation = match require_str(args, "operation") {
        Ok(value) => value,
        Err(error) => return error,
    };
    let path = match require_str(args, "path") {
        Ok(value) => value,
        Err(error) => return error,
    };
    match operation {
        "write" => modify_write(args, path),
        "replace" => modify_replace(args, path),
        "patch" => modify_patch(args, path),
        "delete" => modify_delete(path),
        _ => format!("Неизвестная операция modify: {operation}"),
    }
}

fn modify_write(args: &Value, path: &str) -> String {
    let content = match require_str(args, "content") {
        Ok(value) => value,
        Err(error) => return error,
    };
    if !confirm(&format!("Разрешить запись в файл '{path}'?")) {
        return "Пользователь отклонил запись файла".to_string();
    }
    match std::fs::write(path, content) {
        Ok(()) => format!("Файл '{path}' успешно записан"),
        Err(error) => format!("Не удалось записать файл: {error}"),
    }
}

fn modify_replace(args: &Value, path: &str) -> String {
    let old = match require_str(args, "old_string") {
        Ok(value) => value,
        Err(error) => return error,
    };
    let new = match require_str(args, "new_string") {
        Ok(value) => value,
        Err(error) => return error,
    };
    let replace_all = args["replace_all"].as_bool().unwrap_or(false);
    let content = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) => return format!("Не удалось прочитать файл: {error}"),
    };
    let count = content.matches(old).count();
    if count == 0 {
        return format!("old_string не найден в файле '{path}'");
    }
    if count > 1 && !replace_all {
        return format!(
            "old_string встречается {count} раз(а) в файле '{path}' — уточни его или передай replace_all: true"
        );
    }
    if !confirm(&format!("Разрешить редактирование файла '{path}'?")) {
        return "Пользователь отклонил редактирование файла".to_string();
    }
    let updated = if replace_all {
        content.replace(old, new)
    } else {
        content.replacen(old, new, 1)
    };
    match std::fs::write(path, updated) {
        Ok(()) => format!("Файл '{path}' успешно отредактирован"),
        Err(error) => format!("Не удалось записать файл: {error}"),
    }
}

fn modify_patch(args: &Value, path: &str) -> String {
    let edits = match args["edits"].as_array() {
        Some(edits) if !edits.is_empty() => edits,
        _ => return "Аргумент edits не передан или пуст".to_string(),
    };
    let mut content = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) => return format!("Не удалось прочитать файл: {error}"),
    };
    for (index, edit) in edits.iter().enumerate() {
        let old = match require_str(edit, "old_string") {
            Ok(value) => value,
            Err(error) => return format!("Правка #{}: {error}", index + 1),
        };
        let new = match require_str(edit, "new_string") {
            Ok(value) => value,
            Err(error) => return format!("Правка #{}: {error}", index + 1),
        };
        let count = content.matches(old).count();
        if count != 1 {
            return format!(
                "Правка #{}: old_string встречается {count} раз(а), ожидалось ровно одно",
                index + 1
            );
        }
        content = content.replacen(old, new, 1);
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
        Err(error) => format!("Не удалось записать файл: {error}"),
    }
}

fn modify_delete(path: &str) -> String {
    if !confirm(&format!("Разрешить удалить файл '{path}'?")) {
        return "Пользователь отклонил удаление файла".to_string();
    }
    match std::fs::remove_file(path) {
        Ok(()) => format!("Файл '{path}' удалён"),
        Err(error) => format!("Не удалось удалить файл: {error}"),
    }
}

fn execute(args: &Value) -> String {
    let command = match require_str(args, "command") {
        Ok(value) => value,
        Err(error) => return error,
    };
    if !confirm(&format!("Разрешить выполнить команду '{command}'?")) {
        return "Пользователь отклонил выполнение команды".to_string();
    }
    let mut process = std::process::Command::new("sh");
    process.arg("-c").arg(command);
    if let Some(cwd) = args["cwd"].as_str() {
        process.current_dir(cwd);
    }
    let output = match process.output() {
        Ok(value) => value,
        Err(error) => return format!("Не удалось запустить команду: {error}"),
    };
    let code = output
        .status
        .code()
        .map_or_else(|| "signal".to_string(), |code| code.to_string());
    format!(
        "exit_code: {code}\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_only_three_tools() {
        let definitions = tool_definitions();
        let names: Vec<_> = definitions
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["inspect", "modify", "execute"]);
    }

    #[test]
    fn inspect_reads_selected_lines() {
        let path = std::env::temp_dir().join(format!(
            "rust-coding-agent-{}-inspect.txt",
            std::process::id()
        ));
        std::fs::write(&path, "one\ntwo\nthree\n").unwrap();
        let args = serde_json::json!({"operation":"read","path":path,"start_line":2,"end_line":3});
        assert_eq!(inspect(&args), "two\nthree");
        std::fs::remove_file(path).unwrap();
    }
}
