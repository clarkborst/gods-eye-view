# Replay scenario authoring

Replay scenarios are runtime data: no JavaScript change or application rebuild is
needed to edit a catalog or descriptor. Deploy the updated files and turn
Simulated Traffic off and on to refresh the catalog. Ordinary HTTP cache policy
still applies. The catalog is fetched when the layer is enabled; CZML is fetched
only for the selected scenario.

## Add a location

1. Create a folder here, for example `tokyo/`, containing your CZML files.
2. Create `tokyo/replay.json` using the example below.
3. Add `"tokyo/replay.json"` to `catalog.json`'s `scenarios` array. Array order is
   dropdown order. Set `defaultScenario` to its ID if it should open by default.
4. Enable Simulated Traffic, select the scenario, then press Play.

```json
{
  "$schema": "../scenario.schema.json",
  "version": 1,
  "id": "tokyo-replay",
  "name": "Tokyo · mixed movements",
  "description": "Synthetic movements near Tokyo Bay.",
  "view": {
    "longitude": 139.8,
    "latitude": 35.6,
    "height": 9000,
    "heading": 75,
    "pitch": -45
  },
  "files": ["aircraft.czml", "../shared/vessels.czml"]
}
```

`catalog.schema.json` and `scenario.schema.json` provide editor validation and
completion through `$schema`, including in WebStorm. Version 1 is required for
both documents. IDs must be unique lowercase letters, digits, hyphens or
underscores, beginning with a letter or digit. Names are displayed verbatim;
user-authored scenarios do not need application translations.

Camera longitude/latitude and heading/pitch use degrees. Height is metres above
the WGS84 ellipsoid. Heading defaults to 0 (north), pitch to -90 (straight down).
Each scenario requires an explicit camera view so distant or globe-spanning
routes do not produce an unpredictable overview.

Descriptor paths resolve relative to the catalog; CZML paths resolve relative to
the descriptor. Relative paths preserve deployment prefixes. Absolute HTTP(S)
URLs also work if the server permits CORS. Relative model and image paths inside
CZML resolve from the CZML file's URL. Assets in `public/` are publicly served.

CZML owns replay dates, availability, sampled positions, orientation and vehicle
categories. Every file needs a `document` packet with a valid `clock.interval`.
The replay spans the union of those intervals. Entity IDs must be unique across
all files in a scenario. Use `properties.vehicleCategory` (`aircraft`, `uas`,
`ground-robot`, `vessel`, or another category) for automatic category controls.
See [Rotterdam examples](rotterdam/README.md) for working movement files.

A selection loads transactionally: previous vehicles and clock remain usable if
replacement loading fails. Errors identify missing/invalid descriptors or CZML
assets. Catalog validation is strict: correct invalid entries rather than having
scenarios silently disappear. Initial enable failures are reported by the layer.
Selecting a valid scenario frames its location and pauses at 1×. Live/replay
isolation and cockpit behavior are unchanged.

## Replay aircraft identification colors

Replay detection brackets, labels and leaders use cyan for civil aircraft,
amber for military aircraft, and magenta for UAS in every display theme.
Set `properties.military` to the JSON boolean `true` for military identity;
type codes and callsigns do not imply military status. For example:

```json
"properties": {
  "vehicleCategory": "aircraft",
  "aircraftClass": "helicopter",
  "typeCode": "AH64",
  "military": true
}
```

`vehicleCategory: "uas"` or `aircraftClass: "uas"` selects the UAS tier.
Type codes recognized by the aircraft classifier as UAS also select that tier
when no explicit class is supplied. UAS coloring takes precedence over military
coloring, while the contact retains its military flag. Classification is evaluated
at replay time and survives selection, seeking and cockpit following. Replay path
colors also use the shared palette. GLB model materials remain independently authored.

## Shared vehicle presentation

UAS means **uncrewed aerial system**. New scenarios use `vehicleCategory: "uas"`
or `aircraftClass: "uas"`. The previous `drone` and `uav` input values remain
compatible and normalize to `uas`.

Edit `src/data/vehiclePresentation.js` to configure detection, cockpit and replay
path colors. Civil uses cyan, military uses amber, and UAS uses magenta for
detection, cockpit instruments and paths. Replay paths use these
settings at runtime, overriding authored CZML path colors for aerial vehicles.
Emergency alerts retain their distinct warning colors.
