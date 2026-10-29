# Rotterdam Airport synthetic CZML scenarios

These original, hand-authored examples illustrate plausible movement profiles near
Rotterdam The Hague Airport (EHRD). They are **not recorded traffic, published
procedures, surveyed routes, authorized drone operations, or navigation data**.
Drone operations near an airport require appropriate authorization. The examples
make no claim that the illustrated sites or trajectories are operationally valid.

All files cover **26 October 2026, 10:00–10:20 UTC** and can be loaded together:

- `aircraft.czml`: a narrow-body departure, a descending arrival with landing and
  taxi, a later business-jet departure along an approximate runway 24 axis, and
  a fictional military AH-64 Apache helicopter circuit with takeoff, hover and landing.
- `drones.czml`: a slow inspection circuit with hover and vertical takeoff/landing,
  and a survey lawnmower pattern southeast of the runway.
- `ground.czml`: a slow apron inspection robot with stops and a repeated circuit.

The UI offers combined and individual scenarios. Enable **Simulated Traffic** in
the Movement layer group. The playback clock and timeline appear below the main
banner and remain available when the Data Layers panel is collapsed. Selecting a
scenario automatically frames its location and resets playback to paused at 1×.
Press Play in the top transport to start; reverse, fast-forward, scrub, select a
vehicle to follow, or hide categories.
Turn the layer off to restore live movement and the previous clock policy.

Positions use `cartographicDegrees`: seconds since `epoch`, longitude, latitude,
**WGS84 ellipsoid height in metres**. The approximate surface is 43 m ellipsoid
height; this is a demo datum, not a terrain survey or MSL altitude. Convert real
AGL/MSL routes to ellipsoid height before authoring production CZML. Ground paths
are not terrain-clamped, so detailed terrain/3D tiles may differ from these paths.
Linear interpolation avoids high-order overshoot. Repeated positions encode
stops/hover; HOLD extrapolation keeps vehicles at their first/last sample within
the document's availability interval. Trails show the preceding three minutes.

## Extending vehicle categories

Use a document packet with a finite `clock.interval`, unique entity IDs, sampled
`position`, and `properties.vehicleCategory` on each vehicle. The category value is
an arbitrary stable string (`aircraft`, `drone`, `ground-robot`, `vessel`, etc.). The
panel discovers categories and counts dynamically; there is no vehicle-type
switch in the clock/controller. Supply CZML point/billboard/model/path styling.
For models the layer derives orientation from velocity unless explicit orientation
is present; hovering vehicles with authored attitude should provide orientation.

Scenario descriptors are JSON files alongside these CZML files (`mixed.json`,
`aircraft.json`, `drones.json`, `ground.json`), listed in `../catalog.json`.
Edit their camera views and file lists without changing JavaScript. See
[scenario authoring](../README.md) for adding locations and editor schemas.
Files in a combined scenario share the union of their document clock intervals;
keep IDs unique and epochs/availability compatible. Simulation mode remains
session-local and excluded from share links and automatic stored-layer restore.
Weather and Director playback are not synchronized to the scenario clock.

## Validation

With the development server running, execute:

```sh
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm run qa:simulation
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/qa-traffic-modes.mjs
```

Use your installed Chromium/Chrome executable path, or omit the variable when
Puppeteer's downloaded browser is installed. The browser gate exercises the real
layer controls, sampled positions, playback directions, filters, following,
scenario replacement and clock restoration. Evidence is written to the ignored
`qa-artifacts/simulation/` directory. Unit tests under
`src/layers/simulatedTraffic/` cover clock boundaries, cleanup, replacement races,
mode restoration and approximate speed envelopes for the example trajectories.

## Aircraft and drone Context / cockpit controls

Aircraft use the existing class-specific aircraft GLB models. Set the optional
`properties.aircraftClass` to a supported class such as `airliner`, `bizjet`,
`light`, or `helicopter`; otherwise the layer uses the existing type-code
classifier. A `drone` uses the original `public/models/quadcopter.glb` survey-drone
model. Other categories keep their authored CZML graphics. The replay panel includes label visibility and
model-size controls, and clicking an aircraft/drone selects its normal
tracked readout and follow camera.

**Simulated Traffic is the only live/replay mode switch.** Context never enables
or disables replay when opening, closing, or restoring its layer snapshot.
Switching modes closes the previous Contacts/cockpit session; reopen Contacts to
select traffic from the new mode. Live movement stays blocked until Simulated
Traffic is explicitly turned off, which restores the previous live selection.

With simulation enabled, open **Context → Contacts**, select an aircraft or aerial
drone, then choose **Cockpit**. Context routes its aircraft interface to CZML only:
live ADS-B/AIS sources are neither started nor read, including their retained
caches. Aircraft and drones support the usual Context focus and previous/next
navigation. Ground robots remain generic map contacts and do not offer an aerial
cockpit. The cockpit clock and position follow replay time; paused playback does
not coast forward, and seeks and reverse playback use sampled CZML positions.

Replay identification uses the same detection provider, corner brackets and
collision-managed labels as live traffic. Native CZML labels are hidden to avoid
duplicates. Enabling simulation activates the standard detection preset; exiting
restores the previous setting unless another active mode owns it. Manual DETECT
changes remain available during replay. The selected vehicle uses the shared
tracked readout, and the cockpit subject's model and reticle are hidden in first
person. The optional CZML `properties.heading` supplies a stationary model's
heading (degrees clockwise from north); moving models follow sampled velocity.

## Bank attitude and altitude lines

The aircraft examples include standard sampled CZML `orientation.unitQuaternion`
(vehicle frame: +X forward, +Z up), plus sampled `properties.roll` in degrees.
Positive roll is a right bank. The outbound airliner and business jet bank through
opposite turns; the straight-in arrival stays level. The replay renderer keeps
the nose on the instantaneous flown course and applies sampled bank, including
while seeking or playing backward. The cockpit applies the same bank to its
camera up vector, so the horizon rolls through the turn. Cesium's internal glTF
axis conversion is included when aligning the bundled nose-minus-X models.
Regenerate the synthetic attitude after editing route positions with:

```sh
node tools/build_rotterdam_aircraft_attitude.mjs
```

Vertical altitude lines follow the current aircraft/drone positions, including
live civil, military and local ADS-B aircraft. One shared renderer retains up to
256 in-view lines, prioritizing the selected contact. Ground ends use the shared
cached mesh/terrain heights; unresolved heights fall back to the ellipsoid until
surface data is available. Lines update with movement, replay seeking and source
visibility, without starting additional traffic feeds. The first-person subject
is omitted along with its hidden model; other visible aircraft keep their lines.

## Apache example

`sim:rotterdam:apache-01` is included in both the aircraft and mixed scenarios.
It sets `vehicleCategory: "aircraft"`, `aircraftClass: "helicopter"`,
`typeCode: "AH64"` and `military: true`, giving it the military detection tier
and amber brackets/labels. Its authored trail is amber too. The bundled Bell 206
model is a visual stand-in; an Apache-specific GLB is not included. It uses the
same synthetic 43 m ellipsoid surface datum as the other examples, climbs into a
low-altitude circuit, hovers from 10:12 to 10:14 UTC, and lands by 10:15 UTC.
