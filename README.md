# Terra Incognita

Watch the map fill in with every place you've ridden, run or walked. Connect a Strava account and press play to see years of outings reveal the map.

Live at https://terra-incognita.space.fast/ (hosted on Spacefast).

## How it works

- **Front end** (`index.html`, `app.js`, `style.css`): MapLibre GL base map (OpenFreeMap styles in `basemaps.js`) under a canvas "fog" that routes are cut out of. H3 res-9 cells are used only to estimate the explored area.
- **Storage** (`store.js`): activities are kept in the browser's IndexedDB, per athlete. Nothing about activities is stored server-side.
- **Server** (`functions/api/`): Spacefast functions handling Strava OAuth, token refresh, a slim proxy of the activity list, logout/deauthorise, and the Strava webhook (deletes a session when someone deauthorises the app). Sessions live in the Space's database.
- **Demo** (`demo.js`): seeded sample outings around the Peak District, available without a Strava account.

## Configuration

Space variables:

| Name | Purpose |
| --- | --- |
| `STRAVA_CLIENT_ID` | From strava.com/settings/api |
| `STRAVA_CLIENT_SECRET` | From strava.com/settings/api (secret) |
| `STRAVA_VERIFY_TOKEN` | Random string used for the webhook subscription handshake |
| `STRAVA_API_BASE` | Optional override for the Strava API base URL |
| `PUBLIC_ORIGIN` | Optional public origin if it differs from the request URL |

The Strava app's authorisation callback domain must be `terra-incognita.space.fast`.

Webhook subscription (one-off):

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=... -F client_secret=... \
  -F callback_url=https://terra-incognita.space.fast/api/webhook \
  -F verify_token=...
```

## Strava brand assets

`assets/` holds Strava's official "Connect with Strava" button and "Powered by Strava" logo, used unmodified as their brand guidelines require.
