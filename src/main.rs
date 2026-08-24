mod api;
mod tools;

use api::call_model;
use tools::run_tool;

const MAX_TOOL_ROUNDS: u32 = 20;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let token = std::env::var("AI_API_TOKEN").expect("AI_API_TOKEN is missing; check .env");
    let api_url = std::env::var("AI_API_URL").expect("AI_API_URL is missing; check .env");
    let client = reqwest::Client::new();
    let mut history: Vec<serde_json::Value> = Vec::new();

    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    history.push(serde_json::json!({
        "role": "system",
        "content": format!(
            "You are a coding agent working in a terminal. Current working directory: {cwd}.\n\
             Use inspect for reading and searching, modify for all file changes, and execute for commands and checks. \
             Before changing files or running commands, briefly explain what you are going to do and why. \
             Answer concisely and directly."
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

        let mut rounds = 0;

        loop {
            rounds += 1;
            if rounds > MAX_TOOL_ROUNDS {
                println!(
                    "[stopped: exceeded the limit of {MAX_TOOL_ROUNDS} consecutive tool-call rounds]"
                );
                break;
            }

            let parsed = call_model(&client, &api_url, &token, &history).await?;

            let Some(choice) = parsed.choices.first() else {
                println!("The model returned no response");
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
                        "[running: {} {}]",
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
