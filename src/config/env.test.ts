import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeUserConfig, loadUserEnvironment, userConfigPath } from "./env";

const original = {
  configHome: Bun.env.XDG_CONFIG_HOME,
  token: Bun.env.AI_API_TOKEN,
  url: Bun.env.AI_API_URL,
  model: Bun.env.AI_MODEL,
};

afterEach(() => {
  restore("XDG_CONFIG_HOME", original.configHome);
  restore("AI_API_TOKEN", original.token);
  restore("AI_API_URL", original.url);
  restore("AI_MODEL", original.model);
});

describe("user configuration", () => {
  test("initializes a private configuration file", async () => {
    Bun.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "codekeeper-config-"));

    const result = await initializeUserConfig();

    expect(result).toEqual({ path: userConfigPath(), created: true });
    expect(await readFile(result.path, "utf8")).toContain("AI_API_URL=");
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect(await initializeUserConfig()).toEqual({ path: result.path, created: false });
  });

  test("loads user values without overriding process environment", async () => {
    Bun.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "codekeeper-config-"));
    const { path } = await initializeUserConfig();
    await writeFile(
      path,
      "AI_API_TOKEN=file-token\nAI_API_URL=https://api.example/v1\nAI_MODEL=file-model\n",
    );
    Bun.env.AI_API_TOKEN = "process-token";
    delete Bun.env.AI_API_URL;
    delete Bun.env.AI_MODEL;

    await loadUserEnvironment();

    const environment: Record<string, string | undefined> = Bun.env;
    expect(Bun.env.AI_API_TOKEN).toBe("process-token");
    expect(environment.AI_API_URL).toBe("https://api.example/v1");
    expect(environment.AI_MODEL).toBe("file-model");
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}
