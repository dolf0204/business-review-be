#!/usr/bin/env sh
# Checks a running BusinessAsk from the outside. Changes nothing and sends no mail.
# Usage: ./smoke.sh <app address> <api address>
#   ./smoke.sh http://localhost:5190 http://localhost:8090        (local stack)
#   ./smoke.sh https://businessask.eu https://api.businessask.eu  (server)
set -u
APP="${1:?usage: smoke.sh <app address> <api address>}"
API="${2:?usage: smoke.sh <app address> <api address>}"
APP="${APP%/}"; API="${API%/}"
fails=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }

[ "$(code "$API/health")" = 200 ] && ok "API and database answer (/health)" || bad "API /health did not answer 200: is the API or the database down?"
[ "$(code "$APP/")" = 200 ] && ok "front end is served" || bad "front end did not answer 200"
[ "$(code "$APP/b/zzzzzzzz")" = 200 ] && ok "a guest address falls back to the app (SPA fallback)" || bad "/b/<code> did not fall back to the app"
[ "$(code "$API/public/b/zzzzzzzz")" = 404 ] && ok "an unknown business is 404" || bad "unknown business was not 404"
[ "$(code "$API/auth/me")" = 401 ] && ok "owner area is closed without a session" || bad "/auth/me was not 401"
[ "$(code "$API/guest/me")" = 401 ] && ok "guest area is closed without a session" || bad "/guest/me was not 401"
[ "$(code "$API/partners?lat=44.1&lng=15.2")" = 401 ] && ok "partner feed is closed without a key" || bad "/partners was not 401"
[ "$(code -X POST "$API/stripe/webhook" -H 'content-type: application/json' -d '{}')" = 400 ] && ok "Stripe webhook refuses an unsigned request" || bad "webhook did not answer 400 to an unsigned request"
[ "$(code -X DELETE "$API/guest/me")" = 401 ] && ok "deleting guest data needs a session" || bad "DELETE /guest/me was not 401"

# The browser may call the API only from the app's own address.
allow=$(curl -s -m 15 -D - -o /dev/null -H "Origin: $APP" "$API/health" | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d' ' -f2)
[ "$allow" = "$APP" ] && ok "API allows the app's address (CORS)" || bad "CORS does not allow $APP (got '${allow:-nothing}'): check APP_URL"
evil=$(curl -s -m 15 -D - -o /dev/null -H "Origin: https://evil.example" "$API/health" | tr -d '\r' | grep -ic '^access-control-allow-origin: https://evil.example')
[ "$evil" = 0 ] && ok "API refuses other websites (CORS)" || bad "API allowed a foreign website"

headers=$(curl -s -m 15 -D - -o /dev/null "$APP/" | tr -d '\r')
printf '%s' "$headers" | grep -qi '^x-content-type-options: nosniff' && ok "front end sends nosniff" || bad "front end lacks X-Content-Type-Options"
printf '%s' "$headers" | grep -qi "frame-ancestors 'none'" && ok "front end cannot be framed" || bad "front end lacks frame-ancestors"
case "$APP" in https://*) printf '%s' "$headers" | grep -qi '^strict-transport-security' && ok "HSTS is on" || bad "HSTS missing" ;; esac

if [ "$fails" = 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed."; exit 1; fi
