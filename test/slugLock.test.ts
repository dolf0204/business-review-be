import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, findUnique, claimSlug, freeSlugsFor } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  claimSlug: vi.fn(),
  freeSlugsFor: vi.fn(),
}));

vi.mock("../src/db.js", () => ({ prisma: { business: { updateMany, findUnique } } }));
vi.mock("../src/lib/slugs.js", () => ({ SLUG_RESULT: { ok: "ok", taken: "taken", locked: "locked" }, claimSlug, freeSlugsFor }));

import { lockSlug, settleSlug } from "../src/lib/slugLock.js";

const business = { id: "b-1", name: "Točkica", kind: "restaurant", address: null, slug: null, slugLockedAt: null };

beforeEach(() => {
  updateMany.mockReset();
  findUnique.mockReset();
  claimSlug.mockReset();
  freeSlugsFor.mockReset();
});

describe("lockSlug", () => {
  it("locks only a business that has an address and is not locked yet", async () => {
    await lockSlug("b-1");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "b-1", slugLockedAt: null, slug: { not: null } }, data: { slugLockedAt: expect.any(Date) } });
  });
});

describe("settleSlug", () => {
  it("leaves a locked address alone", async () => {
    expect(await settleSlug({ ...business, slug: "tockica", slugLockedAt: new Date() }, "hr")).toBe("tockica");
    expect(freeSlugsFor).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("locks the address the owner already chose", async () => {
    expect(await settleSlug({ ...business, slug: "my-place" }, "hr")).toBe("my-place");
    expect(freeSlugsFor).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("picks the first free address, saves it and locks it", async () => {
    freeSlugsFor.mockResolvedValueOnce(["tockica"]);
    claimSlug.mockResolvedValueOnce("ok");
    expect(await settleSlug(business, "hr")).toBe("tockica");
    expect(freeSlugsFor).toHaveBeenCalledWith("b-1", { name: "Točkica", kind: "restaurant", address: null, lang: "hr" }, 1);
    expect(claimSlug).toHaveBeenCalledWith("b-1", "tockica");
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("tries again when someone takes the address first", async () => {
    freeSlugsFor.mockResolvedValueOnce(["tockica"]).mockResolvedValueOnce(["tockica-restoran"]);
    claimSlug.mockResolvedValueOnce("taken").mockResolvedValueOnce("ok");
    expect(await settleSlug(business, "hr")).toBe("tockica-restoran");
    expect(claimSlug).toHaveBeenCalledTimes(2);
  });

  it("gives up without locking when nothing can be saved", async () => {
    freeSlugsFor.mockResolvedValue(["tockica"]);
    claimSlug.mockResolvedValue("taken");
    expect(await settleSlug(business, "hr")).toBeNull();
    expect(claimSlug).toHaveBeenCalledTimes(5);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("gives up when no address is free", async () => {
    freeSlugsFor.mockResolvedValueOnce([]);
    expect(await settleSlug(business, "hr")).toBeNull();
    expect(claimSlug).not.toHaveBeenCalled();
  });

  it("returns what is saved when the address was locked in the meantime", async () => {
    freeSlugsFor.mockResolvedValueOnce(["tockica"]);
    claimSlug.mockResolvedValueOnce("locked");
    findUnique.mockResolvedValueOnce({ slug: "other-name" });
    expect(await settleSlug(business, "hr")).toBe("other-name");
    expect(updateMany).not.toHaveBeenCalled();
  });
});