import { describe, expect, it } from "vitest";
import { formatVersion } from "./version";

describe("formatVersion", () => {
  it("leaves an exact tag alone", () => {
    expect(formatVersion("v0.4.0")).toBe("v0.4.0");
  });

  it("adds the v goreleaser strips", () => {
    expect(formatVersion("0.4.0")).toBe("v0.4.0");
  });

  it("splits a tag and its commit into two segments", () => {
    expect(formatVersion("v0.4.0-3-g1e9f6ed")).toBe("v0.4.0 · g1e9f6ed");
  });

  it("keeps a prerelease suffix on the tag", () => {
    expect(formatVersion("v0.5.0-rc1-2-gabc1234")).toBe("v0.5.0-rc1 · gabc1234");
  });

  it("shows an untagged build as a commit", () => {
    expect(formatVersion("1e9f6ed")).toBe("g1e9f6ed");
  });

  it("flags a dirty tree", () => {
    expect(formatVersion("v0.4.0-3-g1e9f6ed-dirty")).toBe("v0.4.0 · g1e9f6ed · dirty");
  });

  it("passes a non-git version through", () => {
    expect(formatVersion("dev")).toBe("dev");
  });
});
