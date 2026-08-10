# Handoff: TOPUP — Airtime, Data & eSIM Purchase App (React Native)

## Overview
A mobile app for buying airtime, data bundles and eSIMs on Orange, MTN and Moov networks (Côte d'Ivoire / West Africa market, XOF currency displayed as **FCFA**). Payment via mobile money (with USSD authorization) or card. Includes onboarding by phone + SMS OTP, purchase for self or others, daily deals, transaction history, points-based rewards, and eSIM purchase/management under Profile.

## About the Design Files
`Airtime & Data App.dc.html` (+ `styles.css`, `ios-frame.jsx`, `support.js`) is a **design reference created in HTML** — an interactive prototype showing intended look and behavior, not production code.

`rn-app/` is a **runnable Expo (React Native) port** of that prototype:

```bash
cd rn-app
npm install
npx expo start
```

It uses only Expo-managed dependencies (expo-clipboard, @expo-google-fonts/archivo). Navigation is a single-screen state machine mirroring the prototype — swap in react-navigation for production. All data is hardcoded/simulated; wire real APIs where noted below.

## Fidelity
**High-fidelity.** Colors, typography, spacing and copy are final per the Modernist design system. Recreate pixel-perfectly.

## Design Tokens (see `rn-app/theme.js` and `styles.css`)
- Background `#f3f2f2`, surface `#eae9e9`, text/ink `#201e1d`
- Accent red `#ec3013` (hover/pressed `#dd2b0f`, deep `#ae1800`, tint `#fff2ef`, dark-on-tint `#7c1405`)
- Dividers: strong 2px `rgba(32,30,29,0.4)` between sections; 1px `rgba(32,30,29,0.25)` between rows
- **Border radius: 0 everywhere.** No rounded corners, no soft shadows.
- Font: **Archivo** only — 800 for headings/buttons/prices, 600 semi, 400 body
- Kickers: 10px, uppercase, letter-spacing ~1.4, usually accent red
- Type scale: poster 44–56, h1 32, h2 24–26, row title 14–16, sub 11–12
- Hit targets ≥ 44px (buttons 48px)

## Screens (14)
1. **Welcome** — brand header; full-bleed red poster block, flush-left display type "Airtime, data & eSIMs. In seconds."; GET STARTED.
2. **Sign in** — phone number is the account; carrier auto-detect from prefix (07 Orange, 05 MTN, 01 Moov); SEND CODE (enabled at ≥8 digits).
3. **OTP** — 4-digit centered input (letter-spaced), error banner on wrong code (prototype accepts 1234), verifying state, resend.
4. **Home** — brand + points tag; "Quick buy" AIRTIME/DATA tile pair in a 2px-ruled grid; red daily-deal banner (tap → payment with deal pack pre-loaded); recent recipients with BUY→ shortcut; activity preview.
5. **Recipient (01)** — FOR MYSELF / SOMEONE ELSE toggle (inverted ink cell for active); phone input; 3 carrier cells with auto-detect note; CONTINUE.
6. **Packs (02)** — AIRTIME/DATA toggle; tap a row → payment. Airtime shows a **Custom amount** box: numeric input with live thousands grouping, 100–500 000 FCFA, +5% bonus from 1 000.
7. **Payment (03)** — 2px-bordered order summary; radio list (carrier's mobile money name — "Orange Money"/"MTN MoMo"/"Moov Money" — or Card); points-to-earn note.
   - **Mobile money → USSD step**: CONFIRM reveals an authorize panel with the carrier USSD code (e.g. `#144*82*<amount>#`), a COPY button (clipboard) and DIAL CODE → (opens `tel:` URL, then simulates approval ~1.4s).
   - Card: PAY <amount> with PROCESSING… pulse.
   - Back is context-aware: eSIM checkout → eSIM plans; otherwise → packs.
8. **Success** — red field with display-type "SENT."; receipt rows (to/pack/paid/ref); +N POINTS tag; for eSIM adds an install block (QR + "ADD TO THIS PHONE" — use the platform eSIM provisioning API in production); DONE / BUY ANOTHER PACK.
9. **History** — ruled transaction rows: description, date·network·number meta, amount, red DELIVERED status.
10. **Rewards** — red points-balance field (52px number), "1 point per 100 FCFA"; redeem rows with REDEEM buttons (disabled when unaffordable).
11. **Profile** — initials square + name/number; ruled menu: My eSIMs (count · active), Payment methods, Notifications, Help & support, Sign out (→ welcome).
12. **eSIMs** (from Profile) — 2px-bordered cards: label, ACTIVE/PAUSED tag, ICCID, renewal, data left, TOP UP + PAUSE/ACTIVATE actions; + NEW ESIM.
13. **eSIM destination (01)** — searchable country list (home CI, travel GH/NG/SN/FR/US, regional West Africa/Global) with bordered code squares.
14. **eSIM plans (02)** — plans priced per destination, country tag, purchase reuses payment flow.

**Bottom nav** (tab screens only): HOME · HISTORY · REWARDS · PROFILE — uppercase 10px labels, active = red + 3px top rule.

## State Management
Single store (prototype uses component state): `screen`, `service` ('airtime'|'data'|'esim'), `forSelf`, `phone`, `carrier`, `pack`, `pay` ('momo'|'card'), `paying`, `ussdStep`, `copied`, `otp/otpError/verifying`, `customAmt`, `points`, `history[]`, `esims[]`, `esimCountry`, `countrySearch`. On successful payment: prepend history entry, award ⌊price/100⌋ points.

## Production integration points
- OTP send/verify API; session persistence
- Catalog/pricing API per carrier and destination
- Payment: mobile money collection APIs; the USSD codes shown are carrier-specific and must come from config
- eSIM: provisioning API (iOS `CTCellularPlanProvisioning`, Android `EuiccManager`) for "ADD TO THIS PHONE"; real QR (LPA activation code)
- Points ledger

## Assets
None required — no images or icon fonts. The QR block in the HTML prototype is a placeholder; use a real QR library in production.

## Files
- `Airtime & Data App.dc.html` — the interactive HTML prototype (source of truth for look/behavior)
- `styles.css` — Modernist design-system tokens & classes
- `rn-app/` — Expo app: `App.js` (all screens), `theme.js` (tokens), `package.json`, `app.json`
