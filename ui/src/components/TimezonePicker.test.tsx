import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezonePicker } from "./TimezonePicker";

function Subject({ onChange }: { onChange: (zone: string) => void }) {
  const [value, setValue] = useState("UTC");
  return <TimezonePicker value={value} ariaLabel="Time zone" onChange={(zone) => { setValue(zone); onChange(zone); }} />;
}

describe("TimezonePicker", () => {
  it("shows the full list when opened and filters it as the user types", async () => {
    const user = userEvent.setup();
    render(<Subject onChange={vi.fn()} />);

    await user.click(screen.getByRole("textbox", { name: "Time zone" }));
    expect(screen.getByRole("button", { name: "UTC" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Filter time zones" }), "america/new_york");
    expect(screen.getByRole("button", { name: "America/New_York" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "UTC" })).toBeNull();
  });

  it("selects the filtered time zone", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Subject onChange={onChange} />);

    await user.click(screen.getByRole("textbox", { name: "Time zone" }));
    await user.type(screen.getByRole("textbox", { name: "Filter time zones" }), "america/new_york");
    await user.click(screen.getByRole("button", { name: "America/New_York" }));

    expect(onChange).toHaveBeenCalledWith("America/New_York");
    expect(screen.getByRole("textbox", { name: "Time zone" })).toHaveProperty("value", "America/New_York");
  });
});
