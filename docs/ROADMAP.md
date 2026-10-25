# Roadmap

Built in small slices, each tested and merged before the next one.

0. **Set up** (done): skeleton, schema, `GET /partners`.

Production addresses: front end `https://businessask.eu`, API `https://api.businessask.eu`, sender `no-reply@businessask.eu`.
1. **Business account** (done; see below for what is not verified): sign up with email (verification, password reset), sign in, business profile (name, kind, subtitle and
   offer, address and map position from the Google Maps link, footer with website, social links and contacts, image, design template),
   publish and unpublish.
2. **QR and NFC** (done): stable code per business, QR image (SVG, PNG), a printable sign, the link to write on an NFC tag, the guest landing page `/b/<code>`.
3. **Guests** (done: email link, no password; sign in with Google is optional later and would match the same account by verified email): registration (email, Turnstile), sign in, language, the page shows the offer and the latest news.
4. **Reviews**: first visit asks for a Google review, then a Tripadvisor review; a click on the link (through our redirect) counts as left; "no thanks" asks again after 3 visits.
5. **Loyalty card**: the business sets a period and a rule (for example 10 visits between 1 April and 3 April = free meal); the guest punches
   the card only when the browser location is near the business (needs HTTPS; a staff-code fallback for guests who block location); one punch per guest per day.
6. **Offers**: the business publishes a special offer; registered guests who opted in get it by email (unsubscribe link in every mail).
7. **TouristAsk integration**: TouristAsk reads `GET /partners` (cached), shows the businesses under the guide and on the map, and the manual Sponsors screen is removed.
8. **Billing** (decision pending): Stripe plans for businesses.

Open decisions: location fallback, whether Google Business Profile sign-in is worth the approval process, domain name, pricing.
