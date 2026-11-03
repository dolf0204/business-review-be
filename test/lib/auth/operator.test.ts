import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config.js", async (original) => {
  const actual = await original<typeof import("../../../src/config.js")>();
  return { ...actual, config: { ...actual.config, OPERATOR_EMAILS: "Ops@Example.com, second@example.com" } };
});

import { isOperatorEmail } from "../../../src/lib/auth/operator.js";

describe("isOperatorEmail", () => {
  it("matches the configured addresses whatever their case or spacing", () => {
    expect(isOperatorEmail("ops@example.com")).toBe(true);
    expect(isOperatorEmail("  SECOND@example.com ")).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(isOperatorEmail("owner@example.com")).toBe(false);
    expect(isOperatorEmail("")).toBe(false);
  });
});