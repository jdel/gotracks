import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionInput } from "./ActionInput";
import type { Context, Project, Tag } from "@/lib/types";

const contexts = [
  { id: 1, name: "@home" },
  { id: 2, name: "@calls" },
  { id: 3, name: "@home office" },
] as Context[];
const projects = [{ id: 10, name: "Garden" }] as Project[];
const tags = [{ id: 20, name: "urgent" }] as Tag[];

/** Harness supplies the controlled state the real composer provides. */
function Harness() {
  const [value, setValue] = useState("");
  return (
    <ActionInput
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      contexts={contexts}
      projects={projects}
      tags={tags}
      placeholder="Add an action…"
    />
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText("Add an action…") as HTMLInputElement;
}

describe("ActionInput highlight mirror", () => {
  // The input's text is transparent and the mirror is what the user sees, so the
  // two must lay text out identically. Any padding/border/font difference shifts
  // the glyphs and the caret appears to sit inside a word.
  it("renders exactly the typed characters, with no extra text", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(field());
    await user.keyboard("mow @home #Garden !urgent now");

    const mirror = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(mirror.textContent).toBe("mow @home #Garden !urgent now");
  });

  it("styles tokens without any layout-affecting properties", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(field());
    await user.keyboard("mow @home and #Garden");

    const mirror = container.querySelector("[aria-hidden]") as HTMLElement;
    const tokens = mirror.querySelectorAll("span");
    expect(tokens.length).toBeGreaterThan(0);

    // Padding, borders and margins on a mirror span would offset every following
    // character relative to the real input.
    for (const token of tokens) {
      const cls = token.className;
      expect(cls).not.toMatch(/(^|\s)-?[pm][xytblr]?-/);
      expect(cls).not.toMatch(/(^|\s)border(\s|-|$)/);
      expect(cls).not.toMatch(/tracking-|font-(bold|medium|semibold)/);
    }
  });

  it("gives the mirror and the input identical text metrics", async () => {
    const { container } = render(<Harness />);
    const mirror = container.querySelector("[aria-hidden]") as HTMLElement;
    const input = field();

    // Both carry the same inline style object, so every metric matches.
    for (const prop of ["font", "letterSpacing", "padding", "lineHeight", "boxSizing"] as const) {
      expect(input.style[prop]).toBe(mirror.style[prop]);
      expect(input.style[prop]).not.toBe("");
    }
  });
});

describe("ActionInput autocomplete", () => {
  it("leaves the caret at the end after completing a context", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = field();

    await user.click(input);
    await user.keyboard("mow @ho");
    await user.keyboard("{Enter}");

    expect(input.value).toBe("mow @home ");
    // The caret must sit after the inserted token, not inside it.
    expect(input.selectionStart).toBe(input.value.length);
  });

  it("keeps typing coherent after a completion", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = field();

    await user.click(input);
    await user.keyboard("mow @ho{Enter}the lawn");

    // Text typed after the completion lands at the end, not spliced mid-token.
    expect(input.value).toBe("mow @home the lawn");
  });

  it("completes a project and a tag the same way", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = field();

    await user.click(input);
    await user.keyboard("dig #Gar{Enter}");
    expect(input.value).toBe("dig #Garden ");
    expect(input.selectionStart).toBe(input.value.length);

    await user.keyboard("!urg{Enter}");
    expect(input.value).toBe("dig #Garden !urgent ");
    expect(input.selectionStart).toBe(input.value.length);
  });

  // Enter must reach the form when the only menu row is "create", otherwise a
  // brand-new "@name" swallows the keystroke and nothing gets added.
  it("submits rather than completing when only a create row is offered", async () => {
    const user = userEvent.setup();
    let submitted = 0;
    function SubmitHarness() {
      const [value, setValue] = useState("");
      return (
        <ActionInput
          value={value}
          onChange={setValue}
          onSubmit={() => submitted++}
          contexts={contexts}
          projects={projects}
          tags={tags}
          placeholder="Add an action…"
        />
      );
    }
    render(<SubmitHarness />);

    await user.click(field());
    await user.keyboard("buy paint @errands{Enter}");

    expect(submitted).toBe(1);
    // The text is untouched: the parser already reads "@errands" as a new name.
    expect(field().value).toBe("buy paint @errands");
  });

  it("still completes with Enter when a real suggestion is highlighted", async () => {
    const user = userEvent.setup();
    let submitted = 0;
    function SubmitHarness() {
      const [value, setValue] = useState("");
      return (
        <ActionInput
          value={value}
          onChange={setValue}
          onSubmit={() => submitted++}
          contexts={contexts}
          projects={projects}
          tags={tags}
          placeholder="Add an action…"
        />
      );
    }
    render(<SubmitHarness />);

    await user.click(field());
    await user.keyboard("mow @ho{Enter}");

    expect(field().value).toBe("mow @home ");
    expect(submitted).toBe(0);
  });

  it("accepts the create row with Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());
    await user.keyboard("call @errands{Tab}");
    expect(field().value).toBe("call @errands ");
  });

  it("stops offering contexts once one is present, but keeps offering tags", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    // First context completes normally.
    await user.keyboard("mow @ho{Enter}");
    expect(field().value).toBe("mow @home ");

    // A second "@" offers nothing — no suggestions and no create row.
    await user.keyboard("@ca");
    expect(screen.queryByText("calls")).toBeNull();
    expect(screen.queryByText(/Create @/)).toBeNull();

    // Tags are still unlimited.
    await user.keyboard(" !urg");
    expect(screen.getByText("urgent")).toBeDefined();
  });

  it("stops offering projects once one is present", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("dig #Gar{Enter}");
    expect(field().value).toBe("dig #Garden ");

    await user.keyboard("#other");
    expect(screen.queryByText(/Create #/)).toBeNull();
  });

  it("still completes the context being edited", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    // The only "@" in the text is the one under the caret, so it must complete.
    await user.keyboard("mow @ho");
    expect(screen.getByText("home")).toBeDefined();
  });

  // Only Tab and Enter accept a suggestion; space is always just a space.
  it("does not complete on space", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("mow @ho ");
    expect(field().value).toBe("mow @ho ");

    await user.keyboard("the lawn");
    expect(field().value).toBe("mow @ho the lawn");
  });

  it("does not complete projects or tags on space either", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("dig #Gar !urg ");
    expect(field().value).toBe("dig #Gar !urg ");
  });

  it("inserts a plain space after a bare sigil", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    // "@" with nothing typed must not grab the first context in the list.
    await user.keyboard("cost 100 @ each");
    expect(field().value).toBe("cost 100 @ each");
  });

  it("inserts a plain space when the name is new", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("call @errands now");
    expect(field().value).toBe("call @errands now");
  });

  // Regression: after a new name and a space, the caret is in ordinary text.
  // The menu must close, and Tab must not swallow what was typed after it.
  it("closes the menu once typing continues past a new name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("@errands");
    expect(screen.getByText(/Create @errands/)).toBeDefined();

    await user.keyboard(" buy milk");
    expect(screen.queryByText(/Create @errands/)).toBeNull();
  });

  it("does not let Tab eat text typed after a new name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("@errands buy milk{Tab}");
    expect(field().value).toBe("@errands buy milk");
  });

  it("keeps the menu open while a multi-word name is still being typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    // "home office" is a real context, so the space belongs to the name.
    await user.keyboard("work @home off");
    expect(screen.getByText("home office")).toBeDefined();

    // An existing name resolves unquoted, so completing it shows no quotes.
    await user.keyboard("{Enter}");
    expect(field().value).toBe("work @home office ");
  });

  it("completes an existing multi-word name without quotes even if quotes were typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard('work @"home off{Enter}');
    expect(field().value).toBe("work @home office ");
  });

  it("lets a new multi-word name be typed in quotes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard('call @"phone calls');
    expect(screen.getByText(/Create @"phone calls"/)).toBeDefined();

    // Spaces inside quotes do not end the token.
    await user.keyboard('" the bank');
    expect(field().value).toBe('call @"phone calls" the bank');
    expect(screen.queryByText(/Create @/)).toBeNull();
  });

  it("closes the menu when the words can no longer name anything", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());

    await user.keyboard("mow @home then later");
    expect(screen.queryByText(/Create @/)).toBeNull();
    expect(screen.queryByText("home")).toBeNull();
  });

  it("offers to create an unknown name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());
    await user.keyboard("call @errands");

    expect(screen.getByText(/Create @errands/)).toBeDefined();
    expect(screen.getByText("new context")).toBeDefined();
  });
});
