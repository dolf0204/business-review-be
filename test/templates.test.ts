import { describe, expect, it } from "vitest";
import { profileSchema, TEMPLATES } from "../src/schemas.js";

describe("page templates", () => {
  it("lists the original six first and the new ones after them", () => {
    expect([...TEMPLATES]).toEqual(["classic", "warm", "modern", "elegant", "bold", "fresh", "midnight", "traditional"]);
  });

  it("accepts every template and refuses an unknown one", () => {
    for (const template of TEMPLATES) expect(profileSchema.safeParse({ template }).success).toBe(true);
    expect(profileSchema.safeParse({ template: "neon" }).success).toBe(false);
  });
});