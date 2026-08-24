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
  --stage <name>        Run one diagnostic model stage`;
}
