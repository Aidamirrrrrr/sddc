export async function createGitCheckpoint(
  root: string,
  taskId: string,
  paths: string[],
): Promise<string> {
  const staged = await command(root, ["git", "diff", "--cached", "--quiet"]);
  if (staged.exitCode !== 0)
    throw new Error("Cannot checkpoint while unrelated changes are staged");
  const added = await command(root, ["git", "add", "--", ...paths]);
  if (added.exitCode !== 0) throw new Error(`Failed to stage checkpoint files: ${added.output}`);
  const committed = await command(root, [
    "git",
    "commit",
    "--no-verify",
    "-m",
    `sddc: complete ${taskId}`,
  ]);
  if (committed.exitCode !== 0) {
    await command(root, ["git", "restore", "--staged", "--", ...paths]);
    throw new Error(`Failed to create checkpoint: ${committed.output}`);
  }
  const revision = await command(root, ["git", "rev-parse", "HEAD"]);
  if (revision.exitCode !== 0) throw new Error(`Failed to read checkpoint: ${revision.output}`);
  return revision.output.trim();
}

async function command(
  root: string,
  command: string[],
): Promise<{ exitCode: number; output: string }> {
  const process = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}`.trim() };
}
