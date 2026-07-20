import type { Context, Project, Tag } from "@/lib/types";

export type Sigil = "@" | "#" | "!";

/** All sigils the composer understands, for scanning. */
export const ALL_SIGILS: Sigil[] = ["@", "#", "!"];

function isSigil(ch: string): ch is Sigil {
  return ALL_SIGILS.includes(ch as Sigil);
}

/**
 * Options shared by the parsing helpers.
 *
 * `sigils` limits which prefixes are treated as tokens. A field already scoped
 * to a project passes ["@", "!"], so a "#" there stays ordinary text instead of
 * being silently stripped from the description.
 */
export interface ParseOptions {
  sigils?: Sigil[];
}

function allowed(opts: ParseOptions | undefined, sigil: Sigil): boolean {
  return (opts?.sigils ?? ALL_SIGILS).includes(sigil);
}

/**
 * bare strips a leading sigil from a stored name. Users typically name contexts
 * "@home" and may name projects "#house", so the sigil must not be doubled when
 * a token is inserted or matched.
 */
export function bare(name: string, sigil: Sigil): string {
  return name.startsWith(sigil) ? name.slice(1) : name;
}

export interface ParsedAction {
  /** The description with the @context / #project tokens removed. */
  description: string;
  contextId?: number;
  contextName?: string;
  projectId?: number;
  projectName?: string;
  /** Tags collected from "!tag" tokens, in the order they were typed. */
  tags: string[];
  /** True when the named context/project does not exist yet and will be created. */
  contextIsNew?: boolean;
  projectIsNew?: boolean;
}

interface Named {
  id: number;
  name: string;
}

/**
 * matchAt finds the longest known name that appears immediately after a sigil.
 * Longest-match matters because names contain spaces: "#go tracks" must win over
 * a hypothetical "#go".
 */
function matchAt(text: string, from: number, list: Named[], sigil: Sigil): Named | null {
  let best: Named | null = null;
  for (const item of list) {
    const name = bare(item.name, sigil);
    if (!name) continue;
    const slice = text.slice(from, from + name.length);
    if (slice.toLowerCase() !== name.toLowerCase()) continue;
    // The match must end at a word boundary, so "@home" does not match "@homework".
    const next = text[from + name.length];
    if (next !== undefined && !/\s/.test(next)) continue;
    if (!best || name.length > bare(best.name, sigil).length) best = item;
  }
  return best;
}

interface ResolvedToken {
  /** The existing context/project/tag, or null when the name is new. */
  hit: Named | null;
  name: string;
  /** Characters consumed after the sigil. */
  consumed: number;
}

/**
 * resolveToken reads the token at position `at` (which holds the sigil) and
 * resolves it against the known names.
 *
 * A quoted name is taken literally, then looked up. An unquoted one prefers the
 * longest known name — so "@home office" resolves to that context without
 * quotes — and otherwise falls back to a single new word.
 */
function resolveToken(
  text: string,
  at: number,
  list: Named[],
  sigil: Sigil
): ResolvedToken | null {
  const read = readTokenName(text, at + 1);
  if (!read) return null;

  if (read.quoted) {
    return { hit: exactMatch(list, read.name, sigil), name: read.name, consumed: read.consumed };
  }
  const longest = matchAt(text, at + 1, list, sigil);
  if (longest) {
    return { hit: longest, name: bare(longest.name, sigil), consumed: bare(longest.name, sigil).length };
  }
  return { hit: null, name: read.name, consumed: read.consumed };
}

/** isTokenStart reports whether position i can begin a token (start or after space). */
function isTokenStart(text: string, i: number): boolean {
  return i === 0 || /\s/.test(text[i - 1]);
}

/**
 * newTokenName reads the single word after a sigil, used when no existing name
 * matches. Only one word: an unknown name has no known length to match against,
 * so consuming further words would swallow the description.
 */
function newTokenName(text: string, from: number): string | null {
  const rest = text.slice(from);
  const match = /^[^\s@#!"]+/.exec(rest);
  if (!match) return null;
  return match[0];
}

interface ReadName {
  name: string;
  /** Characters consumed after the sigil, including any quotes. */
  consumed: number;
  quoted: boolean;
}

/**
 * readTokenName reads the name following a sigil.
 *
 * A quoted name — `@"home office"` — may contain spaces. This is the only way to
 * write a *new* multi-word name: an unknown name has no known length, so without
 * quotes there is nothing to say where it ends and the description begins.
 * Existing multi-word names still work unquoted, via longest-match.
 */
function readTokenName(text: string, from: number): ReadName | null {
  if (text[from] === '"') {
    const closing = text.indexOf('"', from + 1);
    if (closing === -1) {
      // Still being typed: treat the rest of the line as the name.
      const name = text.slice(from + 1);
      return name ? { name, consumed: 1 + name.length, quoted: true } : null;
    }
    const name = text.slice(from + 1, closing);
    return name ? { name, consumed: closing - from + 1, quoted: true } : null;
  }
  const word = newTokenName(text, from);
  return word ? { name: word, consumed: word.length, quoted: false } : null;
}

/** exactMatch finds a name equal to the given one, ignoring case and sigil. */
function exactMatch(list: Named[], name: string, sigil: Sigil): Named | null {
  const want = name.toLowerCase();
  return list.find((item) => bare(item.name, sigil).toLowerCase() === want) ?? null;
}

/**
 * parseAction extracts the @context and #project tokens from composer text and
 * returns the remaining description.
 *
 * An unknown token is treated as a *new* context/project (flagged with
 * contextIsNew / projectIsNew) so the server can create it on submit.
 */
export function parseAction(
  text: string,
  contexts: Context[],
  projects: Project[],
  tags: Tag[] = [],
  opts?: ParseOptions
): ParsedAction {
  const out: ParsedAction = { description: "", tags: [] };
  let description = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (isSigil(ch) && allowed(opts, ch) && isTokenStart(text, i)) {
      const sigil = ch;
      const list = sigil === "@" ? contexts : sigil === "#" ? projects : tags;
      const resolved = resolveToken(text, i, list, sigil);

      // An action has exactly one context and one project, so only the first of
      // each is consumed; a later "@x" or "#y" is ordinary text. Tags are
      // unlimited and accumulate.
      const alreadyTaken =
        (sigil === "@" && out.contextName !== undefined) ||
        (sigil === "#" && out.projectName !== undefined);

      if (resolved && !alreadyTaken) {
        const { hit, name, consumed } = resolved;
        switch (sigil) {
          case "@":
            out.contextId = hit?.id;
            out.contextName = hit ? hit.name : name;
            out.contextIsNew = !hit;
            break;
          case "#":
            out.projectId = hit?.id;
            out.projectName = hit ? hit.name : name;
            out.projectIsNew = !hit;
            break;
          case "!":
            // The server normalizes and de-duplicates tags.
            out.tags.push(name);
            break;
        }
        i += 1 + consumed;
        continue;
      }
    }
    description += ch;
    i++;
  }

  out.description = description.replace(/\s+/g, " ").trim();
  return out;
}

export interface TokenSpan {
  start: number;
  end: number;
  sigil: Sigil;
  label: string;
  /** True when this token names something that does not exist yet. */
  isNew: boolean;
}

/** tokenSpans locates recognised tokens so they can be highlighted in place. */
export function tokenSpans(
  text: string,
  contexts: Context[],
  projects: Project[],
  tags: Tag[] = [],
  opts?: ParseOptions
): TokenSpan[] {
  const spans: TokenSpan[] = [];
  // Mirrors parseAction: only the first @context and #project count, so a
  // duplicate is left unhighlighted — the user can see it is not a token.
  let hasContext = false;
  let hasProject = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (isSigil(ch) && allowed(opts, ch) && isTokenStart(text, i)) {
      const sigil = ch;
      const taken = (sigil === "@" && hasContext) || (sigil === "#" && hasProject);
      const list = sigil === "@" ? contexts : sigil === "#" ? projects : tags;
      const resolved = resolveToken(text, i, list, sigil);
      if (resolved && !taken) {
        const end = i + 1 + resolved.consumed;
        spans.push({ start: i, end, sigil, label: text.slice(i, end), isNew: !resolved.hit });
        if (sigil === "@") hasContext = true;
        if (sigil === "#") hasProject = true;
        i = end;
        continue;
      }
    }
    i++;
  }
  return spans;
}

export interface ActiveToken {
  sigil: Sigil;
  query: string;
  /** Index of the sigil in the text. */
  start: number;
  /** True when the name is being typed inside quotes, where spaces are allowed. */
  quoted: boolean;
}

/**
 * activeToken reports the token currently being typed at the caret, which drives
 * the autocomplete menu. Returns null when the caret is not inside a token.
 *
 * A space does not automatically end a token, because names contain spaces
 * ("@home office"). It only keeps spanning while the text typed so far is still
 * the prefix of some known name; once it cannot be, the token ended at that
 * space and the caret is in ordinary description text. Without this, typing
 * "@newthing buy milk" would leave the menu open and let Tab replace the whole
 * run — swallowing everything typed after the token.
 */
export function activeToken(
  text: string,
  caret: number,
  lists?: Partial<Record<Sigil, Named[]>>,
  opts?: ParseOptions
): ActiveToken | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    // Quotes belong to a token; skip over them while scanning back.
    if (ch === '"') continue;

    if (isSigil(ch) && allowed(opts, ch)) {
      if (!isTokenStart(text, i)) return null;

      if (text[i + 1] === '"') {
        // Inside quotes any character is part of the name, until it closes.
        const closing = text.indexOf('"', i + 2);
        if (closing !== -1 && closing < caret) return null;
        return { sigil: ch, query: text.slice(i + 2, caret), start: i, quoted: true };
      }

      const query = text.slice(i + 1, caret);
      if (!/\s/.test(query)) return { sigil: ch, query, start: i, quoted: false };

      const q = query.toLowerCase();
      const stillNamingSomething = (lists?.[ch] ?? []).some((item) =>
        bare(item.name, ch).toLowerCase().startsWith(q)
      );
      return stillNamingSomething ? { sigil: ch, query, start: i, quoted: false } : null;
    }
    if (ch === "\n") return null;
  }
  return null;
}

/** filterSuggestions ranks candidates for the active token. */
export function filterSuggestions<T extends Named>(
  list: T[],
  query: string,
  sigil: Sigil
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, 8);
  const scored = list
    .map((item) => {
      const name = bare(item.name, sigil).toLowerCase();
      if (name.startsWith(q)) return { item, rank: 0 };
      if (name.includes(q)) return { item, rank: 1 };
      return null;
    })
    .filter((v): v is { item: T; rank: number } => v !== null)
    .sort((a, b) => a.rank - b.rank);
  return scored.map((s) => s.item).slice(0, 8);
}

/** quoteIfNeeded wraps a name in quotes when it contains whitespace. */
export function quoteIfNeeded(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name;
}

/**
 * applySuggestion replaces the active token with the chosen name.
 *
 * `quote` is only set for a name that does not exist yet: a new multi-word name
 * needs quotes to mark where it ends, while an existing one resolves unquoted
 * through longest-match, so completing "@home office" stays clean.
 */
export function applySuggestion(
  text: string,
  token: ActiveToken,
  name: string,
  quote = false
): { text: string; caret: number } {
  const plain = bare(name, token.sigil);
  const inserted = `${token.sigil}${quote ? quoteIfNeeded(plain) : plain} `;
  // Replace from the sigil up to the end of what the user had typed, including
  // the opening quote and a closing one if it is already there.
  let endOfQuery = token.start + 1 + (token.quoted ? 1 : 0) + token.query.length;
  if (token.quoted && text[endOfQuery] === '"') endOfQuery++;

  const next = text.slice(0, token.start) + inserted + text.slice(endOfQuery);
  return { text: next, caret: token.start + inserted.length };
}
