import type { Task } from "../tasks/schemas";

/** Tasks sharing a wave, in graph order. */
export function groupByWave(tasks: Task[]): Task[][] {
  const waves = new Map<number, Task[]>();
  for (const task of tasks) {
    const group = waves.get(task.wave);
    if (group) group.push(task);
    else waves.set(task.wave, [task]);
  }
  return [...waves.entries()].sort(([left], [right]) => left - right).map(([, group]) => group);
}

/**
 * Which tasks of a wave may have their proposal generated ahead of time.
 *
 * A wave means no dependency between its tasks, and policy already forbids two of them writing the
 * same file without ordering. Reads are not constrained, though: a task may read a file another
 * member of its wave writes or creates. Generating that task's proposal early would build it from
 * content that is about to change, so only tasks whose reads are disjoint from every other member's
 * writes are safe to prepare in advance.
 */
export function prefetchable(wave: Task[]): Task[] {
  const writes = new Map(
    wave.map((task) => [task.id, new Set([...task.files.modify, ...task.files.create])]),
  );
  return wave.filter((task) =>
    wave.every(
      (other) =>
        other.id === task.id || !task.files.read.some((path) => writes.get(other.id)?.has(path)),
    ),
  );
}
