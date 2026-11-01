export const SHOP_CURRENCY = "eur";

export const SIZES = ["S", "M", "L"] as const;
export type ShopSize = (typeof SIZES)[number];

export const SIZE_PRICE_CENTS: Record<ShopSize, number> = { S: 2000, M: 2500, L: 3000 };

export const FINISHES = ["midnight", "amber", "ivory"] as const;
export type ShopFinish = (typeof FINISHES)[number];

export const CHAPTERS = ["bar", "restaurant", "butcher", "beauty", "pets", "shops"] as const;
export type ShopChapter = (typeof CHAPTERS)[number];

export const DESIGNS = [
  { id: "bottle", chapter: "bar" },
  { id: "neon", chapter: "bar" },
  { id: "coasters", chapter: "bar" },
  { id: "coasterset", chapter: "bar" },
  { id: "cloche", chapter: "restaurant" },
  { id: "plateStand", chapter: "restaurant" },
  { id: "bowl", chapter: "restaurant" },
  { id: "easel", chapter: "restaurant" },
  { id: "board", chapter: "butcher" },
  { id: "chopBlock", chapter: "butcher" },
  { id: "cleaver", chapter: "butcher" },
  { id: "pole", chapter: "beauty" },
  { id: "comb", chapter: "beauty" },
  { id: "halo", chapter: "beauty" },
  { id: "bone", chapter: "pets" },
  { id: "paw", chapter: "pets" },
  { id: "slab", chapter: "shops" },
  { id: "bloom", chapter: "shops" },
  { id: "hook", chapter: "shops" },
  { id: "arch", chapter: "shops" },
] as const satisfies readonly { id: string; chapter: ShopChapter }[];

export type ShopDesignId = (typeof DESIGNS)[number]["id"];

export const DESIGN_IDS = DESIGNS.map((d) => d.id) as [ShopDesignId, ...ShopDesignId[]];

export const YEARLY_DISCOUNT_PERCENT = 25;
export const SHIPPING_CENTS = 0;
export const PRINT_TEXT_MAX = 32;
export const MAX_ITEMS_PER_ORDER = 10;

export const publicCatalog = () => ({
  currency: SHOP_CURRENCY,
  sizes: SIZES.map((size) => ({ size, priceCents: SIZE_PRICE_CENTS[size] })),
  finishes: FINISHES,
  chapters: CHAPTERS.map((id) => ({ id, designs: DESIGNS.filter((d) => d.chapter === id).map((d) => d.id) })),
  yearlyDiscountPercent: YEARLY_DISCOUNT_PERCENT,
  shippingCents: SHIPPING_CENTS,
  printTextMax: PRINT_TEXT_MAX,
  maxItemsPerOrder: MAX_ITEMS_PER_ORDER,
});