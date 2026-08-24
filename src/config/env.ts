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

export function loadInputPrice(): number | undefined {
  const value = Bun.env.AI_INPUT_USD_PER_MILLION?.trim();
  if (!value) return undefined;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("AI_INPUT_USD_PER_MILLION must be a non-negative number");
  }
  return price;
}

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}
