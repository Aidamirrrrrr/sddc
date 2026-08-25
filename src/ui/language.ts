/**
 * Which language the interface speaks.
 *
 * Lives below both the CLI helpers and the components so either may ask without importing the
 * other: a component reaching up into the CLI layer for a word is how half a surface ends up in one
 * language and half in another, which is exactly the state this module exists to prevent.
 */
export type Copy = { en: string; ru: string };

let russian = false;

export function setLanguage(value: string): void {
  russian = /^(ru|russian|рус)/i.test(value.trim());
}

export function language(): "ru" | "en" {
  return russian ? "ru" : "en";
}

/** The one way any surface turns a pair of strings into the one the reader asked for. */
export function t(copy: Copy): string {
  return russian ? copy.ru : copy.en;
}
