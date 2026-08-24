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

pub async fn call_model(
    client: &reqwest::Client,
    api_url: &str,
    token: &str,
    history: &[serde_json::Value],
) -> Result<ChatResponse, Box<dyn std::error::Error>> {
    let response = client
        .post(api_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-5-nano",
            "messages": history,
            "temperature": 0.7,
            "tools": crate::tools::tool_definitions()
        }))
        .send()
        .await?;

    let response_text = response.text().await?;

    match serde_json::from_str::<ChatResponse>(&response_text) {
        Ok(parsed) => Ok(parsed),
        Err(e) => {
            Err(format!("Failed to parse API response: {e}. Raw response: {response_text}").into())
        }
    }
}
