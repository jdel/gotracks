import { describe, expect, it } from "vitest";
import {
  activeToken,
  applySuggestion,
  bare,
  filterSuggestions,
  parseAction,
  tokenSpans,
} from "./composer";
import type { Context, Project, Tag } from "./types";

const contexts = [
  { id: 1, name: "@home" },
  { id: 2, name: "@calls" },
  { id: 3, name: "@home office" },
] as Context[];

const projects = [
  { id: 10, name: "Garden" },
  { id: 11, name: "go tracks" },
  { id: 12, name: "#house" },
] as Project[];

const tags = [
  { id: 20, name: "urgent" },
  { id: 21, name: "errand" },
] as Tag[];

describe("bare", () => {
  it("strips only a leading sigil", () => {
    expect(bare("@home", "@")).toBe("home");
    expect(bare("Garden", "#")).toBe("Garden");
    expect(bare("#house", "#")).toBe("house");
    // An inner sigil is left alone.
    expect(bare("a@b", "@")).toBe("a@b");
  });
});

describe("parseAction", () => {
  it("extracts context and project and cleans the description", () => {
    const r = parseAction("mow lawn @home #Garden", contexts, projects);
    expect(r.description).toBe("mow lawn");
    expect(r.contextId).toBe(1);
    expect(r.projectId).toBe(10);
  });

  it("accepts tokens anywhere in the text", () => {
    const r = parseAction("@calls ring the dentist", contexts, projects);
    expect(r.description).toBe("ring the dentist");
    expect(r.contextId).toBe(2);
  });

  it("matches names containing spaces, preferring the longest", () => {
    const r = parseAction("write docs @home office #go tracks", contexts, projects);
    expect(r.contextId).toBe(3);
    expect(r.projectId).toBe(11);
    expect(r.description).toBe("write docs");
  });

  it("does not match a prefix of a longer word", () => {
    // "@homework" is not the context "@home" — it is a new name instead.
    const r = parseAction("finish @homework", contexts, projects);
    expect(r.contextId).toBeUndefined();
    expect(r.contextName).toBe("homework");
    expect(r.contextIsNew).toBe(true);
    expect(r.description).toBe("finish");
  });

  it("treats an unknown token as a new context/project to create", () => {
    const r = parseAction("email @bob about #stuff", contexts, projects);
    expect(r.contextId).toBeUndefined();
    expect(r.contextName).toBe("bob");
    expect(r.contextIsNew).toBe(true);
    expect(r.projectId).toBeUndefined();
    expect(r.projectName).toBe("stuff");
    expect(r.projectIsNew).toBe(true);
    // Both tokens leave the description.
    expect(r.description).toBe("email about");
  });

  it("takes only the first word for a new name", () => {
    // An unknown name has no known length, so it cannot greedily eat the rest.
    const r = parseAction("@errands buy milk and bread", contexts, projects);
    expect(r.contextName).toBe("errands");
    expect(r.contextIsNew).toBe(true);
    expect(r.description).toBe("buy milk and bread");
  });

  it("marks a known token as not new", () => {
    const r = parseAction("mow @home", contexts, projects);
    expect(r.contextIsNew).toBe(false);
    expect(r.contextId).toBe(1);
  });

  it("does not create from a bare sigil with nothing after it", () => {
    const r = parseAction("cost is 100 @ ", contexts, projects);
    expect(r.contextName).toBeUndefined();
    expect(r.description).toBe("cost is 100 @");
  });

  it("ignores a sigil that is mid-word", () => {
    const r = parseAction("mail me@home.com", contexts, projects);
    expect(r.contextId).toBeUndefined();
    expect(r.description).toBe("mail me@home.com");
  });

  it("does not double the sigil for names already stored with one", () => {
    const r = parseAction("paint #house", contexts, projects);
    expect(r.projectId).toBe(12);
    expect(r.description).toBe("paint");
  });

  it("is case-insensitive", () => {
    const r = parseAction("call @CALLS", contexts, projects);
    expect(r.contextId).toBe(2);
  });

  it("collapses whitespace left behind by removed tokens", () => {
    const r = parseAction("  buy   @home   milk  ", contexts, projects);
    expect(r.description).toBe("buy milk");
  });
});

describe("parseAction with !tags", () => {
  it("collects multiple tags and strips them from the description", () => {
    const r = parseAction("call plumber !urgent !errand", contexts, projects, tags);
    expect(r.tags).toEqual(["urgent", "errand"]);
    expect(r.description).toBe("call plumber");
  });

  it("accepts a tag that does not exist yet", () => {
    const r = parseAction("ship it !release", contexts, projects, tags);
    expect(r.tags).toEqual(["release"]);
    expect(r.description).toBe("ship it");
  });

  it("mixes all three sigils", () => {
    const r = parseAction(
      "mow lawn @home #Garden !urgent",
      contexts,
      projects,
      tags
    );
    expect(r.contextId).toBe(1);
    expect(r.projectId).toBe(10);
    expect(r.tags).toEqual(["urgent"]);
    expect(r.description).toBe("mow lawn");
  });

  it("leaves an exclamation inside prose alone", () => {
    const r = parseAction("it works!", contexts, projects, tags);
    expect(r.tags).toEqual([]);
    expect(r.description).toBe("it works!");
  });

  it("has no tags when none are typed", () => {
    const r = parseAction("plain action", contexts, projects, tags);
    expect(r.tags).toEqual([]);
  });
});

describe("only one context and one project", () => {
  it("keeps the first @context and leaves a second as plain text", () => {
    const r = parseAction("call @home then @calls", contexts, projects, tags);
    expect(r.contextId).toBe(1);
    expect(r.description).toBe("call then @calls");
  });

  it("keeps the first #project and leaves a second as plain text", () => {
    const r = parseAction("dig #Garden not #house", contexts, projects, tags);
    expect(r.projectId).toBe(10);
    expect(r.description).toBe("dig not #house");
  });

  it("applies the rule to new names too", () => {
    const r = parseAction("task @first @second", contexts, projects, tags);
    expect(r.contextName).toBe("first");
    expect(r.description).toBe("task @second");
  });

  it("still allows any number of tags", () => {
    const r = parseAction("ship !a !b !c !d", contexts, projects, tags);
    expect(r.tags).toEqual(["a", "b", "c", "d"]);
    expect(r.description).toBe("ship");
  });

  it("does not highlight the duplicate token", () => {
    const spans = tokenSpans("call @home then @calls", contexts, projects, tags);
    expect(spans.map((s) => s.label)).toEqual(["@home"]);
  });
});

describe("quoted multi-word names", () => {
  it("creates a new context whose name has spaces", () => {
    const r = parseAction('call the bank @"phone calls"', contexts, projects, tags);
    expect(r.contextName).toBe("phone calls");
    expect(r.contextIsNew).toBe(true);
    expect(r.description).toBe("call the bank");
  });

  it("creates a new project whose name has spaces", () => {
    const r = parseAction('paint #"garden shed" now', contexts, projects, tags);
    expect(r.projectName).toBe("garden shed");
    expect(r.projectIsNew).toBe(true);
    expect(r.description).toBe("paint now");
  });

  it("creates a multi-word tag", () => {
    const r = parseAction('sort it !"needs review"', contexts, projects, tags);
    expect(r.tags).toEqual(["needs review"]);
    expect(r.description).toBe("sort it");
  });

  it("resolves a quoted name to an existing entry", () => {
    const r = parseAction('write docs @"home office"', contexts, projects, tags);
    expect(r.contextId).toBe(3);
    expect(r.contextIsNew).toBe(false);
    expect(r.description).toBe("write docs");
  });

  it("still resolves existing multi-word names without quotes", () => {
    const r = parseAction("write docs @home office", contexts, projects, tags);
    expect(r.contextId).toBe(3);
    expect(r.description).toBe("write docs");
  });

  it("handles an unterminated quote while typing", () => {
    const r = parseAction('buy paint @"garden sh', contexts, projects, tags);
    expect(r.contextName).toBe("garden sh");
    expect(r.contextIsNew).toBe(true);
    expect(r.description).toBe("buy paint");
  });

  it("highlights the whole quoted token", () => {
    const spans = tokenSpans('call @"phone calls" now', contexts, projects, tags);
    expect(spans.map((s) => s.label)).toEqual(['@"phone calls"']);
  });
});

describe("activeToken inside quotes", () => {
  it("keeps the token open across spaces", () => {
    const text = 'call @"phone ca';
    const t = activeToken(text, text.length, { "@": contexts });
    expect(t).toMatchObject({ sigil: "@", query: "phone ca", quoted: true });
  });

  it("ends the token after the closing quote", () => {
    const text = 'call @"phone calls" now';
    expect(activeToken(text, text.length, { "@": contexts })).toBeNull();
  });
});

describe("applySuggestion quoting", () => {
  // An existing name resolves unquoted via longest-match, so no quotes appear.
  it("completes an existing multi-word name without quotes", () => {
    const text = "work @home off";
    const token = activeToken(text, text.length, { "@": contexts })!;
    const out = applySuggestion(text, token, "@home office");
    expect(out.text).toBe("work @home office ");
    expect(out.caret).toBe(out.text.length);
  });

  it("drops the quotes the user typed when completing an existing name", () => {
    const text = 'work @"home off';
    const token = activeToken(text, text.length, { "@": contexts })!;
    const out = applySuggestion(text, token, "@home office");
    expect(out.text).toBe("work @home office ");
  });

  it("quotes only a new multi-word name", () => {
    const text = 'call @"phone calls';
    const token = activeToken(text, text.length, { "@": contexts })!;
    const out = applySuggestion(text, token, "phone calls", true);
    expect(out.text).toBe('call @"phone calls" ');
  });

  it("does not quote a new single-word name", () => {
    const text = "call @errands";
    const token = activeToken(text, text.length, { "@": contexts })!;
    const out = applySuggestion(text, token, "errands", true);
    expect(out.text).toBe("call @errands ");
  });

  // The completed text must parse back to the same context.
  it("round-trips an unquoted multi-word completion", () => {
    const text = "work @home off";
    const token = activeToken(text, text.length, { "@": contexts })!;
    const out = applySuggestion(text, token, "@home office");
    const parsed = parseAction(out.text, contexts, projects, tags);
    expect(parsed.contextId).toBe(3);
    expect(parsed.description).toBe("work");
  });
});

describe("restricted sigils", () => {
  // A field already scoped to a project must not treat "#" as a token, or the
  // text would be stripped from the description and silently reassigned.
  it("leaves #project as plain text when disabled", () => {
    const r = parseAction("buy paint #Garden !urgent", contexts, projects, tags, {
      sigils: ["@", "!"],
    });
    expect(r.projectId).toBeUndefined();
    expect(r.projectName).toBeUndefined();
    expect(r.tags).toEqual(["urgent"]);
    expect(r.description).toBe("buy paint #Garden");
  });

  it("does not highlight a disabled sigil", () => {
    const spans = tokenSpans("buy paint #Garden @home", contexts, projects, tags, {
      sigils: ["@", "!"],
    });
    expect(spans.map((s) => s.label)).toEqual(["@home"]);
  });

  it("offers no completion for a disabled sigil", () => {
    const text = "buy paint #Gar";
    expect(activeToken(text, text.length, { "#": projects }, { sigils: ["@", "!"] })).toBeNull();
  });

  it("ignores !tags in a recurring field", () => {
    const r = parseAction("water plants @home !weekly", contexts, projects, tags, {
      sigils: ["@", "#"],
    });
    expect(r.tags).toEqual([]);
    expect(r.contextId).toBe(1);
    expect(r.description).toBe("water plants !weekly");
  });
});

describe("tokenSpans", () => {
  it("marks known tokens as existing and unknown ones as new", () => {
    // Each sigil appears once, since a duplicate @ or # is not a token at all.
    const spans = tokenSpans("mow @home #Garden !brandnew", contexts, projects, tags);
    expect(spans.map((s) => [s.label, s.isNew])).toEqual([
      ["@home", false],
      ["#Garden", false],
      ["!brandnew", true],
    ]);
  });
});

describe("activeToken", () => {
  it("detects a token being typed at the caret", () => {
    const text = "mow @ho";
    const t = activeToken(text, text.length);
    expect(t).toEqual({ sigil: "@", query: "ho", start: 4, quoted: false });
  });

  it("returns null outside a token", () => {
    expect(activeToken("plain text", 10)).toBeNull();
  });

  it("returns null for a mid-word sigil", () => {
    const text = "me@home";
    expect(activeToken(text, text.length)).toBeNull();
  });

  it("gives up once the run is clearly prose", () => {
    const text = "@ this is definitely just prose now";
    expect(activeToken(text, text.length)).toBeNull();
  });

  // A space only stays inside the token while it can still name something.
  it("keeps spanning a space that is part of a real name", () => {
    const text = "work @home off";
    const t = activeToken(text, text.length, { "@": contexts });
    expect(t?.query).toBe("home off");
  });

  it("ends the token when the words cannot name anything", () => {
    const text = "@errands buy milk";
    expect(activeToken(text, text.length, { "@": contexts })).toBeNull();
  });

  it("ends the token after a completed name", () => {
    const text = "mow @home then";
    expect(activeToken(text, text.length, { "@": contexts })).toBeNull();
  });
});

describe("filterSuggestions", () => {
  it("ranks prefix matches above substring matches", () => {
    const out = filterSuggestions(contexts, "ho", "@");
    expect(out[0].id).toBe(1);
  });

  it("returns everything for an empty query", () => {
    expect(filterSuggestions(contexts, "", "@")).toHaveLength(3);
  });
});

describe("applySuggestion", () => {
  it("replaces the typed token and returns the new caret", () => {
    const text = "mow @ho";
    const token = activeToken(text, text.length)!;
    const out = applySuggestion(text, token, "@home");
    expect(out.text).toBe("mow @home ");
    expect(out.caret).toBe(out.text.length);
  });

  it("keeps text that follows the token", () => {
    const text = "mow @ho the lawn";
    // Caret sits right after "ho".
    const token = activeToken(text, 7)!;
    const out = applySuggestion(text, token, "@home");
    expect(out.text).toBe("mow @home  the lawn");
  });
});
