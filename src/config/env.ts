export type ModelConfig = {
  apiUrl: string;
  apiToken: string;
  model: string;
};

export function loadModelConfig(): ModelConfig {
  return {
    apiUrl: requiredEnv("AI_API_URL").replace(/\/+$/, ""),
    apiToken: requiredEnv("AI_API_TOKEN"),
    model: requiredEnv("AI_MODEL"),
  };
}

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}
