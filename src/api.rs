use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,
}

#[derive(Deserialize, Debug)]
pub struct Choice {
    pub message: Message,
}

#[derive(Deserialize, Debug)]
pub struct Message {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Deserialize, Debug)]
pub struct ToolCall {
    pub id: String,
    pub function: FunctionCall,
}

#[derive(Deserialize, Debug)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

const API_URL: &str = "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/57453037-879f-4306-aa42-0fe9b1696bc6/v1/chat/completions";

pub async fn call_model(
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
