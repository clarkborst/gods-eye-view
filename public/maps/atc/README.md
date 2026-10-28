# Self-hosted ATC boundaries

The ATC presentation uses these bundled GeoJSON files only. It needs no imagery
provider, API key or runtime connection to Natural Earth/GitHub. The application
and its optional live data layers may make their own requests independently.

Data: Natural Earth, 1:50 million scale, public domain.

- `coastlines.geojson`: `ne_50m_coastline`
- `borders.geojson`: `ne_50m_admin_0_boundary_lines_land`

Source: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
Terms: https://www.naturalearthdata.com/about/terms-of-use/
Retrieved 2026-10-28. Feature attributes have been removed to reduce payload size;
geometries are retained. Natural Earth represents disputed boundaries according
to its own conventions. These are cartographic outlines, not operational aviation
charts, airspace boundaries or navigation data.

## Use

Open **Visual Presets → Map Presentation → ATC**. The normal geographic map
sources are hidden from the tray while ATC is active; choose **Geographic** to
return to the previous source. Existing visual effects remain independent: Normal
is clean, while CRT can add a radar display treatment. Contacts, replay, data
layers and camera controls continue to work normally.

ATC uses a dark ellipsoid with no basemap imagery, terrain shading, atmospheric
haze or Google 3D tiles. Coastlines and country borders can be enabled separately.
Line color, brightness and width are configurable; preferences are saved in
browser local storage as `gev:atc-map:v1`. The ATC map source is included in
shared-view map selection. Existing camera orientation is preserved when switching
maps so changing presentation does not interrupt tracking.

GeoJSON is loaded once per controller, validated as line geometry, and rendered
in two batched polyline collections. Long segments are sampled along their shortest
geodesic at intervals no greater than 20 km, including crossings at ±180°.
Positions are lifted 100 m above the ellipsoid to avoid depth fighting. The 1:50m
scale is intended for global/regional context; local airport layouts need a more
detailed independent layer.

Switching back restores the scene atmosphere, globe color, terrain and source
policy. Failed/cancelled preparation does not replace the active map. Controller
teardown releases the boundary collections. To update the dataset, replace the
files with valid FeatureCollections of LineString/MultiLineString features and
retain the source/terms documentation.

## Verification

Run the focused map tests with `node --test src/maps/*.test.mjs`. With the dev
server running, `npm run qa:atc-map` checks rendering, controls, preference
persistence, geographic restoration, caching, mobile layout, replay and teardown.
Use `PUPPETEER_EXECUTABLE_PATH` if Chromium is installed outside Puppeteer's cache,
and `-- --url http://localhost:PORT` for another dev server address.
