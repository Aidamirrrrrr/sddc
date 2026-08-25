import type { Driver } from "./driver";

/**
 * The non-interactive surfaces. `plain` writes stable lines for humans reading a log; `json` writes
 * one event per line for automation. Neither can prompt, so every prompt is a programming error
 * here: `--no-input` is expected to have steered the caller away before it asks.
 */
export function createStreamDriver(mode: "plain" | "json"): Driver {
  const write = (type: string, payload: Record<string, unknown>, line: string): void => {
    if (mode === "json") console.log(JSON.stringify({ type, ...payload }));
    else console.log(line);
  };
  const refuse = (message: string): never => {
    throw new Error(
      `${message} requires an interactive terminal. Rerun without --no-input, --plain, or --json.`,
    );
  };

  return {
    begin: (title) => write("start", { name: title }, title),
    finish: (message) => write("finish", { message }, message),
    info: (message) => write("info", { message }, message),
    success: (message) => write("success", { message }, message),
    warn: (message) => write("warn", { message }, message),
    step: (current, total, message) =>
      write("step", { current, total, message }, `[${current}/${total}] ${message}`),
    banner: (details) =>
      write("banner", details, `sddc ${details.version} · ${details.project} · ${details.model}`),
    document: (title, content) => write("document", { title, content }, `\n${title}\n${content}`),
    action: (summary, details, tone = "success") =>
      write(
        "action",
        { summary, details, tone },
        [summary, ...details.map((detail) => `  ${detail}`)].join("\n"),
      ),
    async stage(labels, operation) {
      write("info", { message: labels.progress }, labels.progress);
      const result = await operation();
      write("success", { message: labels.complete }, labels.complete);
      return result;
    },
    select: (message) => refuse(message),
    multiselect: (message) => refuse(message),
    confirm: (message) => refuse(message),
    text: (message) => refuse(message),
    cancel(message) {
      write("cancel", { message }, message);
      process.exit(0);
    },
  };
}
