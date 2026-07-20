import { describe, expect, it } from "vitest";
import {
  isPasswordValid,
  passwordRules,
  MIN_PASSWORD_LENGTH,
  isLoginValid,
  normaliseLogin,
} from "./password";

// These cases are the same table as internal/auth/password_policy_test.go.
// The two implementations must agree, or the form accepts what the server
// rejects (or worse, blocks what it would accept).
const CASES: [string, boolean][] = [
  ["Str0ng!Passw0rd", true],
  ["Aa1!aaaaaa", true],
  ["Aa1!aaaaa", false],
  ["str0ng!passw0rd", false],
  ["STR0NG!PASSW0RD", false],
  ["Strong!Password", false],
  ["Str0ngPassw0rd1", false],
  ["", false],
  ["abcdefghijklmnopqrst", false],
  ["Str0ng«Passw0rd", true],
  ["Aa1!éééééé", true],
];

describe("password policy mirror", () => {
  it.each(CASES)("agrees with the server for %j", (password, valid) => {
    expect(isPasswordValid(password)).toBe(valid);
  });

  it("reports which rules are unmet, for the live hints", () => {
    const byId = Object.fromEntries(passwordRules("abcdefghij").map((r) => [r.id, r.met]));
    expect(byId).toEqual({ length: true, lower: true, upper: false, digit: false, symbol: false });
  });

  it("counts characters, not bytes", () => {
    // Ten astral-plane characters: ten characters, forty bytes.
    expect(passwordRules("🙂".repeat(10)).find((r) => r.id === "length")?.met).toBe(true);
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });
});

// Mirrors internal/auth/login_test.go so the form and the server agree.
describe("login name mirror", () => {
  const CASES: [string, boolean][] = [
    ["alice", true],
    ["alice-99", true],
    ["alice_99", true],
    ["abc", true],
    ["ab", false],
    ["alice bob", false],
    ["alice.bob", false],
    ["alice@example.com", false],
    ["élise", false],
    ["", false],
    ["Alice", true], // normalised, not rejected
    ["a".repeat(32), true],
    ["a".repeat(33), false],
  ];

  it.each(CASES)("agrees with the server for %j", (login, valid) => {
    expect(isLoginValid(login)).toBe(valid);
  });

  it("lower-cases and trims", () => {
    expect(normaliseLogin("  Alice_99 ")).toBe("alice_99");
  });
});
