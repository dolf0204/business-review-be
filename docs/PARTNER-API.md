# Partner API (for TouristAsk)

TouristAsk shows businesses as sponsors by **reading** this feed. The business app owns the data; TouristAsk keeps no copy.

```
GET /partners?lat=44.1194&lng=15.2314&radiusKm=25&kind=restaurant
x-api-key: <a key from PARTNER_API_KEYS>
```

| Parameter | Meaning |
| --- | --- |
| `lat`, `lng` | The guide's position. |
| `radiusKm` | 1 to 50, default 25. |
| `kind` | Optional: restaurant, cafe, bar, beauty, shop, sport, sight, beach, other. |

Answer: `{ "partners": [ { id, code, name, kind, tagline, offerText, address, lat, lng, distanceKm, imageUrl, rating, ratingCount, websiteUrl, googleMapsUrl, googleReviewUrl, pageUrl } ] }`,
published businesses only, nearest first, at most 500. `401 unauthorized` without a valid key. `pageUrl` is the
business's own page (`APP_URL/b/<code>`), where the guest registers and uses the loyalty card.

Rules for the TouristAsk side: call it from the backend only (the key is a secret), cache the answer for about 10 minutes
per guide, give it a short timeout, and show nothing when it fails.

Later additions (not built): loyalty summary per business ("10 visits = free meal until 3 April") and a `since` parameter for changes.
