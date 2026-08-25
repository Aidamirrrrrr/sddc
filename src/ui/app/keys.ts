import { useInput, useStdin } from "ink";

/**
 * Keyboard input, guarded.
 *
 * Ink's `useInput` throws when stdin cannot enter raw mode, and it throws *from render*, which takes
 * the whole frame down rather than merely disabling a key. Every component that reads keys needs the
 * same guard, so it lives here instead of being remembered five times.
 *
 * Ink honours the guard only when it is strictly `false`, so the value is coerced rather than
 * passed through.
 */
export function useKeys(handler: Parameters<typeof useInput>[0]): void {
  const { isRawModeSupported } = useStdin();
  useInput(handler, { isActive: isRawModeSupported === true });
}
