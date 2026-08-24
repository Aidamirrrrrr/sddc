use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn tool_definitions() -> Value {
    serde_json::json!([
        {"type":"function","function":{"name":"inspect","description":"Inspect the project without changing it: read a file, list a directory, or search for text in files","parameters":{"type":"object","properties":{"operation":{"type":"string","enum":["read","list","search"]},"path":{"type":"string","description":"File or directory path (defaults to .)"},"query":{"type":"string","description":"Text to find with search"},"start_line":{"type":"integer","minimum":1},"end_line":{"type":"integer","minimum":1}},"required":["operation"]}}},
        {"type":"function","function":{"name":"modify","description":"Create, change, or delete a file. Prefer replace or patch for targeted changes","parameters":{"type":"object","properties":{"operation":{"type":"string","enum":["write","replace","patch","delete"]},"path":{"type":"string"},"content":{"type":"string","description":"Complete file contents for write"},"old_string":{"type":"string"},"new_string":{"type":"string"},"replace_all":{"type":"boolean"},"edits":{"type":"array","description":"Sequence of exact replacements for an atomic patch","items":{"type":"object","properties":{"old_string":{"type":"string"},"new_string":{"type":"string"}},"required":["old_string","new_string"]}}},"required":["operation","path"]}}},
        {"type":"function","function":{"name":"execute","description":"Run a shell command such as tests, type checking, or linting and return stdout, stderr, and the exit code","parameters":{"type":"object","properties":{"command":{"type":"string"},"cwd":{"type":"string","description":"Working directory for the command"}},"required":["command"]}}}
    ])
}

fn parse_args(arguments: &str) -> Result<Value, String> {
    serde_json::from_str(arguments).map_err(|e| format!("Failed to parse arguments: {e}"))
}

fn require_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("Missing argument: {key}"))
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
        _ => format!("Unknown tool: {name}"),
    }
}

fn inspect(args: &Value) -> String {
    match require_str(args, "operation") {
        Ok("read") => inspect_read(args),
        Ok("list") => inspect_list(args),
        Ok("search") => inspect_search(args),
        Ok(operation) => format!("Unknown inspect operation: {operation}"),
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
        Err(error) => return format!("Failed to read file: {error}"),
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
        Err(error) => return format!("Failed to read directory: {error}"),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => return format!("Failed to read directory entry: {error}"),
        };
        let mut name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() {
            name.push('/');
        }
        names.push(name);
    }
    names.sort();
    if names.is_empty() {
        "Directory is empty".to_string()
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
        return format!("Search failed: {error}");
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
        "No matches found".to_string()
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
        _ => format!("Unknown modify operation: {operation}"),
    }
}

fn modify_write(args: &Value, path: &str) -> String {
    let content = match require_str(args, "content") {
        Ok(value) => value,
        Err(error) => return error,
    };
    if !confirm(&format!("Allow writing to '{path}'?")) {
        return "The user declined the file write".to_string();
    }
    match std::fs::write(path, content) {
        Ok(()) => format!("File '{path}' was written successfully"),
        Err(error) => format!("Failed to write file: {error}"),
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
        Err(error) => return format!("Failed to read file: {error}"),
    };
    let count = content.matches(old).count();
    if count == 0 {
        return format!("old_string was not found in '{path}'");
    }
    if count > 1 && !replace_all {
        return format!(
            "old_string occurs {count} times in '{path}'; make it unique or pass replace_all: true"
        );
    }
    if !confirm(&format!("Allow editing '{path}'?")) {
        return "The user declined the file edit".to_string();
    }
    let updated = if replace_all {
        content.replace(old, new)
    } else {
        content.replacen(old, new, 1)
    };
    match std::fs::write(path, updated) {
        Ok(()) => format!("File '{path}' was edited successfully"),
        Err(error) => format!("Failed to write file: {error}"),
    }
}

fn modify_patch(args: &Value, path: &str) -> String {
    let edits = match args["edits"].as_array() {
        Some(edits) if !edits.is_empty() => edits,
        _ => return "The edits argument is missing or empty".to_string(),
    };
    let mut content = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) => return format!("Failed to read file: {error}"),
    };
    for (index, edit) in edits.iter().enumerate() {
        let old = match require_str(edit, "old_string") {
            Ok(value) => value,
            Err(error) => return format!("Edit #{}: {error}", index + 1),
        };
        let new = match require_str(edit, "new_string") {
            Ok(value) => value,
            Err(error) => return format!("Edit #{}: {error}", index + 1),
        };
        let count = content.matches(old).count();
        if count != 1 {
            return format!(
                "Edit #{}: old_string occurs {count} times; expected exactly one occurrence",
                index + 1
            );
        }
        content = content.replacen(old, new, 1);
    }
    if !confirm(&format!(
        "Allow applying {} edits to '{path}'?",
        edits.len()
    )) {
        return "The user declined the patch".to_string();
    }
    match std::fs::write(path, content) {
        Ok(()) => format!(
            "File '{path}' was edited successfully ({} edits)",
            edits.len()
        ),
        Err(error) => format!("Failed to write file: {error}"),
    }
}

fn modify_delete(path: &str) -> String {
    if !confirm(&format!("Allow deleting '{path}'?")) {
        return "The user declined the file deletion".to_string();
    }
    match std::fs::remove_file(path) {
        Ok(()) => format!("File '{path}' was deleted"),
        Err(error) => format!("Failed to delete file: {error}"),
    }
}

fn execute(args: &Value) -> String {
    let command = match require_str(args, "command") {
        Ok(value) => value,
        Err(error) => return error,
    };
    if !confirm(&format!("Allow running command '{command}'?")) {
        return "The user declined command execution".to_string();
    }
    let mut process = std::process::Command::new("sh");
    process.arg("-c").arg(command);
    if let Some(cwd) = args["cwd"].as_str() {
        process.current_dir(cwd);
    }
    let output = match process.output() {
        Ok(value) => value,
        Err(error) => return format!("Failed to run command: {error}"),
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
