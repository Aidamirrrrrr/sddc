import { join } from "node:path";

const MAX_BYTES = 16 * 1024;

/**
 * Project principles that the deterministic policy cannot express: architectural rules, testing
 * doctrine, house style. The policy blocks; the constitution only informs the model, so it is
 * supplied as prose and never parsed.
 */
export async function loadConstitution(root: string): Promise<string> {
  const file = Bun.file(join(root, ".sddc", "constitution.md"));
  if (!(await file.exists())) return "";
  const text = (await file.text()).trim();
  if (Buffer.byteLength(text) > MAX_BYTES) {
    throw new Error(`.sddc/constitution.md is larger than ${MAX_BYTES} bytes`);
  }
  return text;
}
