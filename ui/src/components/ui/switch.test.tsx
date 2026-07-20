import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

// Mirrors how AdminPage drives the self-registration setting: controlled value,
// change handler firing the mutation.
function Subject({ onChange, disabled = false }: { onChange: (v: boolean) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <Switch
      checked={on}
      disabled={disabled}
      aria-label="Allow self-registration"
      onCheckedChange={(checked) => {
        setOn(checked);
        onChange(checked);
      }}
    />
  );
}

describe("Switch", () => {
  it("reports the new value when clicked, both ways", async () => {
    const onChange = vi.fn();
    render(<Subject onChange={onChange} />);

    const toggle = screen.getByRole("switch", { name: "Allow self-registration" });
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("is operable from the keyboard", async () => {
    const onChange = vi.fn();
    render(<Subject onChange={onChange} />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("switch"));
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("exposes its state, so it is not just a styled div", () => {
    render(<Subject onChange={() => {}} />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("does not fire while disabled, so an in-flight save cannot be double-sent", async () => {
    const onChange = vi.fn();
    render(<Subject onChange={onChange} disabled />);

    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
