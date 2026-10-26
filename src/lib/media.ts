import { config } from "../config.js";

const FILE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp";
const RELATIVE = new RegExp(`^/media/${FILE}$`);
// An optional address in front (whatever the API was called when the image was uploaded), then /media/<uuid>.webp.
const ANY_MEDIA = new RegExp(`(?:https?://[^"\\s\\\\<>]*)?(/media/${FILE})`, "g");
const STORED = new RegExp(`^(?:https?://[^\\s]*)?(/media/${FILE})$`);
const FILENAME = new RegExp(`(${FILE})$`);

export const isRelativeMedia = (v: string) => RELATIVE.test(v);

/** What gets saved: our own images lose their address ("/media/<id>.webp"), so moving the API never breaks them. */
export function toStoredImageUrl(v: string): string {
  return STORED.exec(v)?.[1] ?? v;
}

/** What is sent out: every image of ours gets the API address that is configured now. */
export function expandMedia(text: string, base = config.PUBLIC_API_URL): string {
  const origin = base.replace(/\/+$/, "");
  return text.replace(ANY_MEDIA, (_m, path: string) => `${origin}${path}`);
}

/** The file name behind one of our image addresses, or null for anything else. */
export const mediaFilename = (v: string | null | undefined) => (v ? FILENAME.exec(toStoredImageUrl(v))?.[1] ?? null : null);
