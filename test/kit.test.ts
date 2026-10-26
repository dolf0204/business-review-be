import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  business: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  kitRequest: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/db.js", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("../src/lib/mail.js", () => mail);

import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { isKitKey, kitKey, kitOperatorMail, shipCountries } from "../src/lib/kit.js";

const ID = "11111111-1111-4111-8111-111111111111";
const KID = "33333333-3333-4333-8333-333333333333";
const BIZ = { id: ID, ownerId: "u1", code: "abcd2345", name: "Konoba <Ribar>", paidUntil: new Date(Date.now() + 30 * 86_400_000) };
const address = { name: "Ana Horvat", line1: "Obala 1", postalCode: "23000", city: "Zadar", country: "hr", printText: "Konoba Ribar" };

async function owner(method: "GET" | "POST", url: string, payload?: object) {
  const app = await buildApp();
  const res = await app.inject({ method, url, payload, headers: { cookie: `session=${app.jwt.sign({ sub: "u1" })}` } });
  await app.close();
  return res;
}

describe("kit rules", () => {
  it("keys belong to one request and the server secret", () => {
    const key = kitKey(KID, config.JWT_SECRET);
    expect(isKitKey(key, KID, config.JWT_SECRET)).toBe(true);
    expect(isKitKey(key, ID, config.JWT_SECRET)).toBe(false);
    expect(isKitKey("short", KID, config.JWT_SECRET)).toBe(false);
  });
  it("reads the list of countries, upper case and without junk", () => {
    expect(shipCountries("hr, de ,XX1,,it,HR")).toEqual(["HR", "DE", "IT"]);
  });
  it("escapes everything the owner typed in the mail to the maker", () => {
    const m = kitOperatorMail({ business: "<b>K</b>", ownerEmail: "o@example.com", printText: "<script>", name: "A & B", line1: "Obala 1", line2: null, postalCode: "1", city: "Z", country: "HR", phone: null, qrUrl: "https://x/b/c?s=q", nfcUrl: "https://x/b/c?s=n", link: "https://x/op?k=1&key=2" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>K</b>");
    expect(m.html).toContain("A &amp; B");
    expect(m.html).toContain("https://x/b/c?s=n");
  });
});

describe("asking for the kit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.business.findFirst.mockResolvedValue(BIZ);
    db.kitRequest.findFirst.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ email: "owner@example.com" });
    db.kitRequest.create.mockImplementation(async ({ data }: { data: object }) => ({ id: KID, status: "REQUESTED", line2: null, phone: null, ...data }));
  });

  it("saves the request, mails the maker the QR code as PNG and SVG with the address, and thanks the owner", async () => {
    const res = await owner("POST", `/businesses/${ID}/kit`, address);
    expect(res.statusCode).toBe(201);
    expect(db.kitRequest.create.mock.calls[0]![0].data).toMatchObject({ businessId: ID, country: "HR", printText: "Konoba Ribar", city: "Zadar" });
    const toMaker = mail.sendMail.mock.calls[0]![0];
    expect(toMaker.to).toBe("kits@example.com");
    expect(toMaker.attachments.map((a: { name: string }) => a.name)).toEqual(["qr-abcd2345.png", "qr-abcd2345.svg"]);
    expect(toMaker.attachments[0].content.subarray(1, 4).toString()).toBe("PNG");
    expect(toMaker.html).toContain("http://localhost:5190/b/abcd2345?s=n");
    expect(toMaker.html).toContain(`/operator/kit?k=${KID}&amp;key=`);
    expect(toMaker.html).toContain("Zadar");
    expect(mail.sendMail.mock.calls[1]![0].to).toBe("owner@example.com");
  });

  it("is for paid pages only, one kit per business, and only to the countries we post to", async () => {
    db.business.findFirst.mockResolvedValue({ ...BIZ, paidUntil: null });
    expect((await owner("POST", `/businesses/${ID}/kit`, address)).json().error).toBe("payment_required");
    db.business.findFirst.mockResolvedValue(BIZ);
    db.kitRequest.findFirst.mockResolvedValue({ id: "old" });
    expect((await owner("POST", `/businesses/${ID}/kit`, address)).json().error).toBe("kit_already_requested");
    db.kitRequest.findFirst.mockResolvedValue(null);
    expect((await owner("POST", `/businesses/${ID}/kit`, { ...address, country: "US" })).json().error).toBe("country_not_supported");
    expect(db.kitRequest.create).not.toHaveBeenCalled();
  });

  it("needs the whole address, keeps the sign text short, and keeps other owners out", async () => {
    expect((await owner("POST", `/businesses/${ID}/kit`, { ...address, city: "" })).statusCode).toBe(400);
    expect((await owner("POST", `/businesses/${ID}/kit`, { ...address, printText: "x".repeat(33) })).statusCode).toBe(400);
    db.business.findFirst.mockResolvedValue(null);
    expect((await owner("POST", `/businesses/${ID}/kit`, address)).statusCode).toBe(404);
    expect((await owner("GET", `/businesses/${ID}/kit`)).statusCode).toBe(404);
  });

  it("keeps the request even when the mail cannot be sent", async () => {
    mail.sendMail.mockRejectedValue(new Error("Brevo responded 401: secret detail"));
    const res = await owner("POST", `/businesses/${ID}/kit`, address);
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("secret detail");
  });

  it("shows the owner the current request and where kits are posted", async () => {
    db.kitRequest.findFirst.mockResolvedValue({ id: KID, status: "REQUESTED" });
    const res = await owner("GET", `/businesses/${ID}/kit`);
    expect(res.json()).toMatchObject({ available: true, request: { status: "REQUESTED" } });
    expect(res.json().countries).toContain("HR");
  });
});

describe("marking it as posted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendMail.mockResolvedValue(undefined);
    db.kitRequest.findUnique.mockResolvedValue({ id: KID, status: "REQUESTED", printText: "K", name: "Ana", city: "Zadar", country: "HR", business: { name: "Konoba", ownerId: "u1" } });
    db.user.findUnique.mockResolvedValue({ email: "owner@example.com" });
  });
  const post = async (payload: object) => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/public/operator/kit/shipped", payload });
    await app.close();
    return res;
  };

  it("marks it posted with the key from the mail and tells the owner, with the tracking link", async () => {
    const res = await post({ id: KID, key: kitKey(KID, config.JWT_SECRET), trackingUrl: "https://track.example.com/123" });
    expect(res.statusCode).toBe(200);
    expect(db.kitRequest.update.mock.calls[0]![0].data).toMatchObject({ status: "SHIPPED", trackingUrl: "https://track.example.com/123" });
    expect(mail.sendMail.mock.calls[0]![0]).toMatchObject({ to: "owner@example.com" });
    expect(mail.sendMail.mock.calls[0]![0].html).toContain("https://track.example.com/123");
  });

  it("does nothing the second time, and refuses a wrong key or a link that is not a web address", async () => {
    db.kitRequest.findUnique.mockResolvedValue({ id: KID, status: "SHIPPED", business: { name: "K", ownerId: "u1" } });
    await post({ id: KID, key: kitKey(KID, config.JWT_SECRET) });
    expect(db.kitRequest.update).not.toHaveBeenCalled();
    expect((await post({ id: KID, key: "x".repeat(43) })).statusCode).toBe(400);
    expect((await post({ id: KID, key: kitKey(KID, config.JWT_SECRET), trackingUrl: "javascript:alert(1)" })).statusCode).toBe(400);
  });

  it("shows the maker what the key opens", async () => {
    const app = await buildApp();
    const res = await app.inject({ url: `/public/operator/kit?id=${KID}&key=${kitKey(KID, config.JWT_SECRET)}` });
    const bad = await app.inject({ url: `/public/operator/kit?id=${KID}&key=${"x".repeat(43)}` });
    await app.close();
    expect(res.json()).toMatchObject({ business: "Konoba", city: "Zadar", status: "REQUESTED" });
    expect(bad.statusCode).toBe(400);
  });
});
