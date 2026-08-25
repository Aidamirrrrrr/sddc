import { PRODUCT_NAME, VERSION } from "../config/product";

export function helpText(): string {
  return `${PRODUCT_NAME} ${VERSION}

Usage:
  sddc [options] -- "Describe the task"
  sddc [options] < task.txt
  sddc --recompile tasks -- <feature>
  sddc --analyze -- <feature>
  sddc --eval [--live]

Options:
  -h, --help            Show help
  -v, --version         Show version
  --init                Create the user configuration file
  --thinking on|off     Enable or disable model reasoning
  --lang en|ru          Choose the interface language
  --recompile <phase>   Rebuild a stored feature from plan|tasks|execute
  --analyze             Report drift between spec, plan, and tasks
  --eval                Score the eval corpus with the pipeline's validators
  --eval-record         Record a stored feature as an eval case
  --live                With --eval, regenerate artifacts with the model first
  --stage <name>        Run one diagnostic model stage
  -n, --dry-run         Stop after the accepted task graph
  --no-input            Never prompt; write a draft when approval is required
  --plain               Disable decorative terminal output
  --json                Emit JSON lines; implies --no-input
  --debug               Include stack traces in errors`;
}
