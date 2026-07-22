import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PageContainer } from "./PageContainer";

describe("PageContainer", () => {
  it("uses the standard width unless a data-heavy page requests wide", () => {
    const { container, rerender } = render(<PageContainer>content</PageContainer>);
    expect(container.firstElementChild?.className).toContain("max-w-4xl");

    rerender(<PageContainer size="wide">content</PageContainer>);
    expect(container.firstElementChild?.className).toContain("max-w-6xl");
  });
});
