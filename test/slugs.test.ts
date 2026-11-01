import { describe, expect, it, vi } from "vitest";

const { updateMany, findMany } = vi.hoisted(() => ({ updateMany: vi.fn(), findMany: vi.fn() }));

vi.mock("../src/db.js", () => ({ prisma: { business: { updateMany, findMany } } }));

import { SLUG_RESULT, claimSlug, pickFreeSlugs, takenSlugs } from "../src/lib/slugs.js";

const restaurant = { name: "Točkica", kind: "restaurant", address: "Maceljska ul. 21, 10000, Zagreb, Croatia", lang: "hr" };
const takenBy = (...used: string[]) => async (slugs: string[]) => new Set(slugs.filter((s) => used.includes(s)));

describe("pickFreeSlugs", () => {
  it("puts the plain name first when it is free", async () => {
    expect(await pickFreeSlugs(restaurant, takenBy())).toEqual(["tockica", "tockica-restoran", "tockica-zagreb"]);
  });

  it("moves on to the type and the city when the name is taken", async () => {
    expect(await pickFreeSlugs(restaurant, takenBy("tockica"))).toEqual(["tockica-restoran", "tockica-zagreb", "tockica-restoran-zagreb"]);
  });

  it("falls back to numbers when every named candidate is taken", async () => {
    const used = ["tockica", "tockica-restoran", "tockica-zagreb", "tockica-restoran-zagreb"];
    expect(await pickFreeSlugs(restaurant, takenBy(...used))).toEqual(["tockica-2", "tockica-3", "tockica-4"]);
  });

  it("skips numbers that are taken too", async () => {
    const used = ["tockica", "tockica-restoran", "tockica-zagreb", "tockica-restoran-zagreb", "tockica-2"];
    expect(await pickFreeSlugs(restaurant, takenBy(...used), 1)).toEqual(["tockica-3"]);
  });

  it("only offers numbers when the name has no other candidates", async () => {
    const plain = { name: "Villa Zara", kind: "other", address: null, lang: "en" };
    expect(await pickFreeSlugs(plain, takenBy("villa-zara"))).toEqual(["villa-zara-2", "villa-zara-3", "villa-zara-4"]);
  });

  it("makes up a short address when the name has no usable letters", async () => {
    const [first] = await pickFreeSlugs({ name: "!!", kind: "other", address: null, lang: "en" }, takenBy(), 1);
    expect(first).toMatch(/^page-[a-z0-9]{5}$/);
  });

  it("asks the database once per batch", async () => {
    const lookup = vi.fn(takenBy());
    await pickFreeSlugs(restaurant, lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe("takenSlugs", () => {
  it("returns nothing without asking when there is nothing to check", async () => {
    findMany.mockClear();
    expect((await takenSlugs([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("leaves out the business that is asking", async () => {
    findMany.mockResolvedValueOnce([{ slug: "tockica" }, { slug: null }]);
    const result = await takenSlugs(["tockica", "tockica-zagreb"], "b-1");
    expect([...result]).toEqual(["tockica"]);
    expect(findMany).toHaveBeenLastCalledWith({ where: { slug: { in: ["tockica", "tockica-zagreb"] }, id: { not: "b-1" } }, select: { slug: true } });
  });
});

describe("claimSlug", () => {
  it("saves the address of a business that is not locked yet", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await claimSlug("b-1", "tockica")).toBe(SLUG_RESULT.ok);
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: "b-1", slugLockedAt: null }, data: { slug: "tockica" } });
  });

  it("refuses once the address is locked", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await claimSlug("b-1", "tockica")).toBe(SLUG_RESULT.locked);
  });

  it("reports a clash with someone else's address", async () => {
    updateMany.mockRejectedValueOnce({ code: "P2002" });
    expect(await claimSlug("b-1", "tockica")).toBe(SLUG_RESULT.taken);
  });

  it("does not hide other database errors", async () => {
    updateMany.mockRejectedValueOnce(new Error("connection lost"));
    await expect(claimSlug("b-1", "tockica")).rejects.toThrow("connection lost");
  });
});