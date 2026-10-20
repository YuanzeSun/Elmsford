import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VILLAGE } from "./names";

const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));
const cache = new Map<string, string>();

export type PromptName =
  | "world"
  | "style-judge"
  | "dialogue"
  | "dialogue-context"
  | "extraction"
  | "planner"
  | "encounters"
  | "day-summary"
  | "recap"
  | "reflection"
  | "dictation"
  | "remote-reply"
  | "remote-person"
  | "sim-player"
  | "map"
  | "newcomer";

/** Filled into every prompt, so a name lives in one place. */
const GLOBALS: Record<string, string> = { village: VILLAGE };

/** Text of packages/content/prompts/<name>.md, with the global names filled in. */
export function loadPrompt(name: PromptName): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(`${PROMPTS_DIR}${name}.md`, "utf8").replace(/\{\{(\w+)\}\}/g, (all, key: string) => GLOBALS[key] ?? all);
    cache.set(name, text);
  }
  return text;
}

/** Load a prompt and fill its {{placeholders}}. Unknown placeholders are an error, not a silent blank. */
export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  return loadPrompt(name).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`prompt "${name}" needs {{${key}}}`);
    return value;
  });
}
