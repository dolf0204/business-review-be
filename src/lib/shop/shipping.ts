// Keep in sync with the TouristAsk copy (tourists-faq-backend/src/shop/shipping.ts).
export const HOME_COUNTRY = "HR";
export const SHIPPING_HOME_CENTS = 500;
export const SHIPPING_ABROAD_CENTS = 1500;

export const SHIP_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB", "AL", "BA", "ME", "MK", "RS",
] as const;

export type ShipCountry = (typeof SHIP_COUNTRIES)[number];

export const isShipCountry = (value: string): value is ShipCountry => (SHIP_COUNTRIES as readonly string[]).includes(value);

export const shippingCentsFor = (country: ShipCountry): number => (country === HOME_COUNTRY ? SHIPPING_HOME_CENTS : SHIPPING_ABROAD_CENTS);