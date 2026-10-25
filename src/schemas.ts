import { z } from "zod";

export const KINDS = ["restaurant", "cafe", "bar", "beauty", "shop", "sport", "sight", "beach", "other"] as const;
export const TEMPLATES = ["classic", "warm", "modern"] as const;
export const UI_LANGS = ["en", "hr"] as const;

export const idParam = z.object({ id: z.uuid() });

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Free text: trimmed, and an empty field means "none". */
const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));
const httpUrl = z.url({ protocol: /^https?$/ }).max(500);
/** An address on one of the given sites (or their subdomains), so a social link cannot point anywhere else. */
const siteUrl = (...hosts: string[]) =>
  httpUrl.refine((u) => {
    const h = new URL(u).hostname.toLowerCase();
    return hosts.some((x) => h === x || h.endsWith(`.${x}`));
  });
const optionalUrl = <T extends z.ZodType<string>>(schema: T) => z.union([z.literal("").transform(() => null), schema]);

export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(KINDS),
    subtitle: text(120),
    // The headline offer TouristAsk shows next to the business, for example "10% off for our guests".
    offerText: text(100),
    websiteUrl: optionalUrl(httpUrl),
    instagramUrl: optionalUrl(siteUrl("instagram.com")),
    facebookUrl: optionalUrl(siteUrl("facebook.com", "fb.com")),
    tripadvisorReviewUrl: optionalUrl(siteUrl("tripadvisor.com", "tripadvisor.co.uk", "tripadvisor.de", "tripadvisor.it", "tripadvisor.fr", "tripadvisor.es", "tripadvisor.hr")),
    phone: text(40),
    contactEmail: z.union([z.literal("").transform(() => null), z.email().max(200)]),
    template: z.enum(TEMPLATES),
    primary: color,
    accent: color,
  })
  .partial();

export type Profile = z.infer<typeof profileSchema>;
