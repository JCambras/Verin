/**
 * Restricted shell-command reading for CI evidence (ADR-0055). YAML hands over
 * a step's `run` VALUE; only the SHELL decides what actually executes, so shell
 * comments are stripped, continuations rejoined, and a "simple command" is
 * tokenized fail-closed - any metacharacter the tokenizer cannot prove inert
 * makes the command non-evidence.
 */
export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * One script line with its trailing shell comment removed, quote-aware so a `#`
 * inside `'...'` or `"..."` stays part of the command. A `#` only opens a comment
 * at the start of a word, so `foo#bar` and `--color=#fff` are untouched.
 */
function stripShellComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === "\\" && quote !== "'") i += 1;
    else if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

/**
 * The commands a `run:` script actually EXECUTES: one entry per logical shell
 * line, comments dropped and `\` continuations rejoined. Splitting per line
 * rather than concatenating the script keeps a match from spanning two unrelated
 * commands.
 */
export function shellCommandLines(script: string): string[] {
  const commands: string[] = [];
  let pending = "";
  for (const raw of script.split("\n")) {
    const stripped = stripShellComment(raw).trim();
    if (stripped.endsWith("\\")) {
      pending += `${stripped.slice(0, -1)} `;
      continue;
    }
    const command = collapse(pending + stripped);
    if (command !== "") commands.push(command);
    pending = "";
  }
  const trailing = collapse(pending);
  if (trailing !== "") commands.push(trailing);
  return commands;
}

export function simpleShellCommand(script: string): { text: string; tokens: string[] } | undefined {
  const commands = shellCommandLines(script);
  if (commands.length !== 1) return undefined;
  const text = commands[0]!;
  const tokens: string[] = [];
  let token = "";
  let touched = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else token += ch;
      touched = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = undefined;
      } else if (ch === "\\") {
        const next = text[i + 1];
        if (next === undefined) return undefined;
        token += next;
        i += 1;
      } else {
        if (ch === "$" || ch === "`") return undefined;
        token += ch;
      }
      touched = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (touched) {
        tokens.push(token);
        token = "";
        touched = false;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      touched = true;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) return undefined;
      token += next;
      touched = true;
      i += 1;
      continue;
    }
    if ("$`;&|<>()[]{}!*?~".includes(ch)) return undefined;
    token += ch;
    touched = true;
  }
  if (quote !== undefined) return undefined;
  if (touched) tokens.push(token);
  return tokens.length === 0 ? undefined : { text, tokens };
}

export function commandMatches(actual: readonly string[] | undefined, required: readonly string[]): boolean {
  return actual !== undefined && actual.length === required.length && required.every((token, index) => actual[index] === token);
}
