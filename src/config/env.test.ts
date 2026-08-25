import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeUserConfig,
  loadMaxOutputTokens,
  loadRequestTimeout,
  loadUserEnvironment,
  saveUserSetting,
  userConfigPath,
} from "./env";

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
    Bun.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "sddc-config-"));

    const result = await initializeUserConfig();

    expect(result).toEqual({ path: userConfigPath(), created: true });
    expect(await readFile(result.path, "utf8")).toContain("AI_API_URL=");
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect(await initializeUserConfig()).toEqual({ path: result.path, created: false });
  });

  test("loads user values without overriding process environment", async () => {
    Bun.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "sddc-config-"));
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

test("the completion cap can be removed deliberately", () => {
  const previous = Bun.env.AI_MAX_OUTPUT_TOKENS;
  try {
    for (const value of ["off", "none", "max", "0", "OFF"]) {
      Bun.env.AI_MAX_OUTPUT_TOKENS = value;
      // Undefined means the parameter is not sent, so the model's own maximum applies.
      expect(loadMaxOutputTokens()).toBeUndefined();
    }
    Bun.env.AI_MAX_OUTPUT_TOKENS = "65536";
    expect(loadMaxOutputTokens()).toBe(65_536);
    Bun.env.AI_MAX_OUTPUT_TOKENS = "";
    expect(loadMaxOutputTokens()).toBe(32_768);
    Bun.env.AI_MAX_OUTPUT_TOKENS = "12";
    expect(() => loadMaxOutputTokens()).toThrow('must be "off" or an integer');
  } finally {
    if (previous === undefined) delete Bun.env.AI_MAX_OUTPUT_TOKENS;
    else Bun.env.AI_MAX_OUTPUT_TOKENS = previous;
  }
});

test("a setting is written once and then found on the next run", async () => {
  const home = await mkdtemp(join(tmpdir(), "sddc-settings-"));
  const previous = Bun.env.XDG_CONFIG_HOME;
  Bun.env.XDG_CONFIG_HOME = home;
  try {
    await writeFile(userConfigPath(), "AI_API_TOKEN=secret\nAI_MODEL=some-model\n", {
      mode: 0o600,
      flag: "w",
    }).catch(async () => {
      await initializeUserConfig();
      await writeFile(userConfigPath(), "AI_API_TOKEN=secret\nAI_MODEL=some-model\n");
    });

    await saveUserSetting("SDDC_LANG", "ru");
    const written = await readFile(userConfigPath(), "utf8");

    // The one line changes and every other byte survives, so a hand-edited file is not rewritten.
    expect(written).toContain("SDDC_LANG=ru");
    expect(written).toContain("AI_API_TOKEN=secret");
    expect(written).toContain("AI_MODEL=some-model");

    await saveUserSetting("SDDC_LANG", "en");
    const updated = await readFile(userConfigPath(), "utf8");
    expect(updated).toContain("SDDC_LANG=en");
    expect(updated).not.toContain("SDDC_LANG=ru");
    // And the process sees it immediately, not only on the next start.
    expect(Bun.env.SDDC_LANG).toBe("en");
  } finally {
    if (previous === undefined) delete Bun.env.XDG_CONFIG_HOME;
    else Bun.env.XDG_CONFIG_HOME = previous;
  }
});

test("the request timeout is bounded, and refuses a value too small to be one", () => {
  const previous = Bun.env.AI_REQUEST_TIMEOUT_SECONDS;
  try {
    Bun.env.AI_REQUEST_TIMEOUT_SECONDS = "";
    expect(loadRequestTimeout()).toBe(300_000);

    Bun.env.AI_REQUEST_TIMEOUT_SECONDS = "600";
    expect(loadRequestTimeout()).toBe(600_000);

    // A reasoning stage on a long context genuinely takes minutes; a two-second ceiling would only
    // turn every heavy stage into a retry storm.
    Bun.env.AI_REQUEST_TIMEOUT_SECONDS = "2";
    expect(() => loadRequestTimeout()).toThrow("at least 10");
  } finally {
    if (previous === undefined) delete Bun.env.AI_REQUEST_TIMEOUT_SECONDS;
    else Bun.env.AI_REQUEST_TIMEOUT_SECONDS = previous;
  }
});
