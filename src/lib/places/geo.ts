const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line distance between two points on the earth, in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** A box around a point that is certain to contain the circle of that radius, so the database can narrow the search first. */
export function boundingBox(center: { lat: number; lng: number }, radiusKm: number) {
  const dLat = (radiusKm / EARTH_KM) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(rad(center.lat)), 0.01);
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLng: center.lng - dLng, maxLng: center.lng + dLng };
}
