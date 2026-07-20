import { describe, expect, it } from "vitest";
import { filterUsers, nextTriState } from "./adminFilter";
import type { AdminUser } from "./types";

function user(over: Partial<AdminUser>): AdminUser {
  return {
    id: 1,
    email: "alice@example.com",
    isAdmin: false,
    twoFactorEnabled: false,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const users: AdminUser[] = [
  user({ id: 1, email: "alice@example.com", isAdmin: true, twoFactorEnabled: true }),
  user({ id: 2, email: "bob@corp.test", isAdmin: false, twoFactorEnabled: true }),
  user({ id: 3, email: "carol@example.com", isAdmin: true, twoFactorEnabled: false }),
  user({ id: 4, email: "dave@other.org", isAdmin: false, twoFactorEnabled: false }),
];

const all = { query: "", admin: "all", twoFactor: "all" } as const;
const ids = (list: AdminUser[]) => list.map((u) => u.id);

describe("filterUsers", () => {
  it("returns everyone when nothing is set", () => {
    expect(ids(filterUsers(users, all))).toEqual([1, 2, 3, 4]);
  });

  it("matches case-insensitively", () => {
    expect(ids(filterUsers(users, { ...all, query: "ALICE" }))).toEqual([1]);
  });

  it("matches an email substring", () => {
    expect(ids(filterUsers(users, { ...all, query: "corp.test" }))).toEqual([2]);
    // The domain is shared by two accounts.
    expect(ids(filterUsers(users, { ...all, query: "@example.com" }))).toEqual([1, 3]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(ids(filterUsers(users, { ...all, query: "  bob  " }))).toEqual([2]);
  });

  it("matches on the local part as well as the domain", () => {
    expect(ids(filterUsers(users, { ...all, query: "dave" }))).toEqual([4]);
    expect(ids(filterUsers(users, { ...all, query: "other.org" }))).toEqual([4]);
  });

  it("filters on admin, both ways", () => {
    expect(ids(filterUsers(users, { ...all, admin: "on" }))).toEqual([1, 3]);
    expect(ids(filterUsers(users, { ...all, admin: "off" }))).toEqual([2, 4]);
  });

  it("filters on two-factor, both ways", () => {
    expect(ids(filterUsers(users, { ...all, twoFactor: "on" }))).toEqual([1, 2]);
    expect(ids(filterUsers(users, { ...all, twoFactor: "off" }))).toEqual([3, 4]);
  });

  it("combines the query with both toggles", () => {
    // Admins with 2FA off whose name contains "o": carol.
    expect(ids(filterUsers(users, { query: "o", admin: "on", twoFactor: "off" }))).toEqual([3]);
  });

  it("returns nothing when the combination matches no one", () => {
    expect(filterUsers(users, { query: "nobody", admin: "all", twoFactor: "all" })).toEqual([]);
  });
});

describe("nextTriState", () => {
  it("cycles all → on → off → all", () => {
    expect(nextTriState("all")).toBe("on");
    expect(nextTriState("on")).toBe("off");
    expect(nextTriState("off")).toBe("all");
  });
});
