# Mapbox maps

Supply Link uses Mapbox GL JS for account, branch and delivery location pickers.
Saved pins open a read-only Mapbox preview inside the existing workspace. The
preview uses coordinates already returned by the authorized workspace query;
there is no new public location endpoint.

## Configuration

Create a public Mapbox access token and add it to the Git-ignored `.env.local`:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_public_token
```

Restart the development server after adding the token. For production, configure
it before building and redeploying: Next.js embeds `NEXT_PUBLIC_` variables into
the browser bundle. The database demo also needs this token to display Mapbox
maps. An absent token shows a configuration message without sending map requests.

Use a `pk.` public token with the read scopes needed for styles, fonts and tiles.
Restrict its allowed URLs to the development origins you use, such as
`http://127.0.0.1:3000` and `http://localhost:3000`, plus the deployed application
origin. Keep secret `sk.` tokens out of browser configuration. See the official
[token guide](https://docs.mapbox.com/help/dive-deeper/access-tokens/).

The renderer uses the Mapbox Streets v12 style, retains Mapbox attribution and
loads only when a picker or saved-pin preview is mounted. Each map instance may
count toward Mapbox usage; review the [pricing](https://www.mapbox.com/pricing)
for the account's plan and expected traffic.

## Location behavior

Pickers and saved-pin previews include zoom buttons and a fullscreen control on
browsers that support the Fullscreen API. Use Ctrl + scroll (Command + scroll on
Mac) to zoom on desktop, or pinch to zoom on touch devices. Two-finger panning
keeps normal one-finger page scrolling available in forms. Fullscreen maps fill
the screen instead of retaining the embedded map height; exit using the same
control or Escape where supported.

Click the map, drag the marker, use current location, or focus the map and press
Enter after panning with the keyboard. Current location is requested only after
the user clicks its button. Latitude and longitude remain hidden form values.
Stored coordinates keep their existing names; conversion to Mapbox's
`[longitude, latitude]` format happens at the renderer boundary. No database
migration is needed for the renderer change.

Map failures display a message. Existing pins remain saved even if the map cannot
load. Missing or invalid pins are still rejected by the existing server/database
validation. Read-only previews never alter the saved coordinates.

## Future tracking

This change selects the map provider and replaces the pin UI. Foreground pickup tracking is implemented in [driver tracking](driver-tracking.md).
Routing, ETA and background location collection remain separate work. Mapbox GL JS displays updates; it does not
automatically collect or broadcast drivers' positions.

Automated UI tests mock the Mapbox SDK to verify coordinate conversion, clicking,
dragging, preview isolation and cleanup without a token. Live style/tile access
must be verified after configuring a valid token.
