import { PRODUCT_NAME, VERSION } from "../config/product";

export function helpText(): string {
  return `${PRODUCT_NAME} ${VERSION}

Usage:
  codekeeper [options] -- "Describe the task"
  codekeeper [options] < task.txt

Options:
  -h, --help            Show help
  -v, --version         Show version
  --init                Create the user configuration file
  --thinking on|off     Enable or disable model reasoning
  --lang en|ru          Choose the interface language
  --stage <name>        Run one diagnostic model stage
  -n, --dry-run         Stop after the accepted implementation plan
  --no-input            Never prompt; write a draft when approval is required
  --plain               Disable decorative terminal output
  --json                Emit JSON lines; implies --no-input
  --debug               Include stack traces in errors`;
}
