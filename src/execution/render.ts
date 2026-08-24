import type { ExecutionFile } from "./context";
import type { ChangeProposal } from "./schemas";

export function renderProposal(proposal: ChangeProposal, files: ExecutionFile[]): string {
  const previous = new Map(files.map((file) => [file.path, file.content]));
  return proposal.changes
    .map((change) => renderChange(change.path, previous.get(change.path) ?? "", change.content))
    .join("\n");
}

function renderChange(path: string, before: string, after: string): string {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const contextStart = Math.max(0, prefix - 3);
  const oldEnd = oldLines.length - suffix;
  const newEnd = newLines.length - suffix;
  const contextEnd = Math.min(oldLines.length, oldEnd + 3);
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const line of oldLines.slice(contextStart, prefix)) lines.push(` ${line}`);
  for (const line of oldLines.slice(prefix, oldEnd)) lines.push(`-${line}`);
  for (const line of newLines.slice(prefix, newEnd)) lines.push(`+${line}`);
  for (const line of oldLines.slice(oldEnd, contextEnd)) lines.push(` ${line}`);
  return lines.join("\n");
}
