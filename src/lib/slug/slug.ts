import { type Kind, UI_LANGS } from "../../schemas.js";

export type UiLang = (typeof UI_LANGS)[number];

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CITY_PARTS_MIN = 3;

const RESERVED_SYSTEM = [
  "www", "app", "api", "admin", "mail", "smtp", "imap", "pop", "ftp", "ns1", "ns2", "cdn", "static", "assets", "media", "img", "images",
  "status", "support", "help", "blog", "login", "signin", "signup", "register", "dashboard", "billing", "webhook", "webhooks", "test",
  "staging", "stage", "dev", "demo", "root", "localhost", "businessask", "touristask", "tourists", "guest", "guests", "b", "q",
] as const;

const RESERVED_BRANDS = [
  "google", "facebook", "instagram", "meta", "apple", "microsoft", "amazon", "paypal", "stripe", "visa", "mastercard", "airbnb",
  "booking", "tripadvisor", "whatsapp", "tiktok", "youtube", "revolut", "pbz", "erste", "zaba", "rba", "hnb", "fina", "porezna",
  "policija", "mup", "hzzo", "hzmo", "gov",
] as const;

const RESERVED = new Set<string>([...RESERVED_SYSTEM, ...RESERVED_BRANDS]);

const SPECIAL_LETTERS: Record<string, string> = { đ: "dj", ł: "l", ß: "ss", æ: "ae", œ: "oe", ø: "o", ð: "d", þ: "th" };
const SPECIAL_LETTERS_PATTERN = /[đłßæœøðþ]/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_SLUG_RUNS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;
const DIGITS = /\d+/g;
const APOSTROPHES = /['’`]/g;

type TypeWords = Record<UiLang, string>;

const TYPE_WORDS: Record<Kind, TypeWords | null> = {
  restaurant: { en: "restaurant", hr: "restoran", de: "restaurant", it: "ristorante", fr: "restaurant", es: "restaurante", sl: "restavracija", pl: "restauracja", cs: "restaurace", hu: "étterem" },
  cafe: { en: "cafe", hr: "kafić", de: "café", it: "caffè", fr: "café", es: "cafetería", sl: "kavarna", pl: "kawiarnia", cs: "kavárna", hu: "kávézó" },
  bar: { en: "bar", hr: "bar", de: "bar", it: "bar", fr: "bar", es: "bar", sl: "bar", pl: "bar", cs: "bar", hu: "bár" },
  cocktail: { en: "cocktail-bar", hr: "koktel-bar", de: "cocktailbar", it: "cocktail-bar", fr: "bar-à-cocktails", es: "coctelería", sl: "koktajl-bar", pl: "koktajl-bar", cs: "koktejlový-bar", hu: "koktélbár" },
  beauty: { en: "beauty-salon", hr: "salon-ljepote", de: "schönheitssalon", it: "salone-di-bellezza", fr: "salon-de-beauté", es: "salón-de-belleza", sl: "salon-lepote", pl: "salon-urody", cs: "salon-krásy", hu: "szépségszalon" },
  barber: { en: "barber", hr: "brijačnica", de: "barbershop", it: "barbiere", fr: "barbier", es: "barbería", sl: "brivnica", pl: "barber", cs: "barber", hu: "borbély" },
  hairdresser: { en: "hair-salon", hr: "frizerski-salon", de: "friseur", it: "parrucchiere", fr: "coiffeur", es: "peluquería", sl: "frizerski-salon", pl: "fryzjer", cs: "kadeřnictví", hu: "fodrász" },
  shop: { en: "shop", hr: "trgovina", de: "laden", it: "negozio", fr: "boutique", es: "tienda", sl: "trgovina", pl: "sklep", cs: "obchod", hu: "bolt" },
  florist: { en: "florist", hr: "cvjećarnica", de: "blumenladen", it: "fioraio", fr: "fleuriste", es: "floristería", sl: "cvetličarna", pl: "kwiaciarnia", cs: "květinářství", hu: "virágbolt" },
  grocery: { en: "grocery", hr: "market", de: "feinkost", it: "alimentari", fr: "épicerie", es: "alimentación", sl: "market", pl: "spożywczy", cs: "potraviny", hu: "élelmiszer" },
  sport: { en: "sports", hr: "sport", de: "sport", it: "sport", fr: "sport", es: "deporte", sl: "šport", pl: "sport", cs: "sport", hu: "sport" },
  sight: { en: "attraction", hr: "znamenitost", de: "sehenswürdigkeit", it: "attrazione", fr: "attraction", es: "atracción", sl: "znamenitost", pl: "atrakcja", cs: "atrakce", hu: "látnivaló" },
  beach: { en: "beach", hr: "plaža", de: "strand", it: "spiaggia", fr: "plage", es: "playa", sl: "plaža", pl: "plaża", cs: "pláž", hu: "strand" },
  other: null,
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(SPECIAL_LETTERS_PATTERN, (c) => SPECIAL_LETTERS[c] ?? c)
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(APOSTROPHES, "")
    .replace(NON_SLUG_RUNS, "-")
    .replace(EDGE_HYPHENS, "");
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN_LENGTH && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug) && !isReservedSlug(slug);
}

function fit(slug: string): string {
  if (slug.length <= SLUG_MAX_LENGTH) return slug;
  const cut = slug.slice(0, SLUG_MAX_LENGTH);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen >= SLUG_MIN_LENGTH ? cut.slice(0, lastHyphen) : cut).replace(EDGE_HYPHENS, "");
}

const hasPart = (slug: string, part: string) => `-${slug}-`.includes(`-${part}-`);

export function typeWord(kind: string, lang: string): string | null {
  const words = TYPE_WORDS[kind as Kind];
  if (!words) return null;
  const word = words[(UI_LANGS as readonly string[]).includes(lang) ? (lang as UiLang) : "en"];
  return slugify(word) || null;
}

export function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length < CITY_PARTS_MIN) return null;
  for (let i = parts.length - 2; i >= 1; i--) {
    const city = slugify((parts[i] ?? "").replace(DIGITS, " "));
    if (city !== "") return city;
  }
  return null;
}

export type SlugSource = { name: string; kind: string; address: string | null; lang: string };

export function slugCandidates(source: SlugSource): string[] {
  const base = fit(slugify(source.name));
  const type = typeWord(source.kind, source.lang);
  const city = cityFromAddress(source.address);
  const withType = type && !hasPart(base, type) ? type : null;
  const withCity = city && !hasPart(base, city) ? city : null;
  const joined = (...parts: Array<string | null>) => fit(parts.filter((p): p is string => p !== null).join("-"));
  const all = [base, joined(base, withType), joined(base, withCity), joined(base, withType, withCity)];
  return [...new Set(all)].filter(isValidSlug);
}

export function numberedSlug(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(EDGE_HYPHENS, "")}${suffix}`;
}