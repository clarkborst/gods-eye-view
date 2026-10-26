# Rotterdam Airport synthetic CZML scenarios

These original, hand-authored examples illustrate plausible movement profiles near
Rotterdam The Hague Airport (EHRD). They are **not recorded traffic, published
procedures, surveyed routes, authorized drone operations, or navigation data**.
Drone operations near an airport require appropriate authorization. The examples
make no claim that the illustrated sites or trajectories are operationally valid.

All files cover **26 October 2026, 10:00–10:20 UTC** and can be loaded together:

- `aircraft.czml`: a narrow-body departure, a descending arrival with landing and
  taxi, and a later business-jet departure along an approximate runway 24 axis.
- `drones.czml`: a slow inspection circuit with hover and vertical takeoff/landing,
  and a survey lawnmower pattern southeast of the runway.
- `ground.czml`: a slow apron inspection robot with stops and a repeated circuit.

The UI offers combined and individual scenarios. Enable **Simulated Traffic** in
the Movement layer group, then select **View Rotterdam Airport**. Start paused,
play, reverse, fast-forward, scrub, select a vehicle to follow, or hide categories.
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

Add scenario descriptors in `src/layers/simulatedTraffic/scenarios.js`. Files in a
combined scenario share one clock (the union of their document intervals). Keep
IDs globally unique and use compatible epochs/availability. Scenario URLs are
bundled same-origin assets; arbitrary remote/local-file imports are not supported.
Simulation mode is session-local and is intentionally excluded from share links
and automatic stored-layer restoration. Weather and Director playback are not
synchronized to the scenario clock.

## Validation

With the development server running, execute:

```sh
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm run qa:simulation
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
