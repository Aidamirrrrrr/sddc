import { chmod, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "dist", "codekeeper");
const destination = Bun.env.CODEKEEPER_INSTALL_DIR
  ? join(Bun.env.CODEKEEPER_INSTALL_DIR, "codekeeper")
  : join(homedir(), ".local", "bin", "codekeeper");

await mkdir(dirname(source), { recursive: true });
const build = Bun.spawn(
  ["bun", "build", "src/main.ts", "--compile", "--minify", `--outfile=${source}`],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if ((await build.exited) !== 0) throw new Error("Codekeeper build failed");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o755);
const initialize = Bun.spawn([destination, "--init"], { stdout: "inherit", stderr: "inherit" });
if ((await initialize.exited) !== 0) throw new Error("Codekeeper configuration failed");

console.log(`Installed Codekeeper to ${destination}`);
if (!(Bun.env.PATH ?? "").split(":").includes(dirname(destination))) {
  console.log(`Add ${dirname(destination)} to PATH before running codekeeper.`);
}
