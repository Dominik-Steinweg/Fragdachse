# Performance measurements

Existing focused trace capture: `npm run perf:chrome -- --case enemies.high`.

Repeated compact capture (built sites, no Chrome trace):

```powershell
npm run perf:chrome -- --suite --sites D:/perf/sites.json --output-root D:/perf/results --runs 3 --qualities high,low --case review
npm run perf:compare -- --suite D:/perf/results/suite.json --output D:/perf/comparison.json
```

`sites.json` is an array of `{ label, commit, site, public }`; use `baseline` and
`current` labels for the comparison command. `site` contains a production
`performance-lab` build, `public` its matching assets. Build and archive each site
before measuring; do not change its inputs during a run. Bindings use free ports.

The suite uses local Chrome, visible 1920×1080/DPR 1, a seeded random generator,
the fixed scenario map seed, two seconds of warmup, and an explicit local host
session through the normal Room/RPC contracts. This is a rendering/host benchmark,
not a WebRTC transport benchmark. The local session cannot be enabled in a
production build. A normal lab run still connects normally unless `localHost`
is requested. Profiles and cache live under `--output-root`.

Cases: `review`, `review.enemies-100`, `review.enemies-300`,
`review.enemies-500`, `review.player`, `review.fog-rock`, `review.camera`,
`review.explosions`, `review.train`, plus the existing weapon/utility/combat cases.
The explosion case submits twelve simultaneous effect RPCs every second; it does
not simulate damage. The train case uses normal authoritative train destruction.
Absent features in an older revision remain absent: compare the scenario as a
whole and label feature-specific costs n/a rather than transplanting new visuals.
Current enemy cases additionally wait for every fixture mesh pose to be prepared.
Use `--warmup-ms 30000` for sustained dense-enemy comparisons; the older archived
review build used a two-second minimum and includes deferred mesh preparation.
Shadow readiness, active casters, target and geometry bytes are exported in load
counters. A missing shadow probe on old revisions means n/a, not synthetic readiness.

Summary quantiles are medians of per-run quantiles (equal weight for each run).
Frame cadence, inclusive CPU callback, nested CPU scopes, GPU timer query,
draw calls and heap are separate measurements. Nested scopes must not be summed.
The existing GPU timer brackets PRE_RENDER to POST_RENDER. Offscreen GPU work
submitted earlier during Scene.update is outside that timer; its value is a
render-phase time, not total GPU frame time or a per-system attribution.
Texture bytes estimate source RGBA8 textures only: no mipmaps, driver copies or
unregistered targets. GPU timer availability and failed repetitions remain visible.
`--profile on` adds a sampled CPU diagnostic pass; compare ordinary timings using
unprofiled runs. No raw Chrome trace is retained.

`--case load` measures fresh-profile boot, ordinary map 1 entry and return to the
lobby with the same High/Low repetitions. Reveal eligibility is polled at 100 ms;
playable includes the regular countdown. Internal map-ready is n/a when the
revision has no LoadingTimeline. No scenario recording runs during this probe.
`bootRevealMs` starts at browser navigation; `bootToLobbyMs` starts at the app's
boot marker. Navigation timing and resource evidence identify connection delays
before any game code runs, separately from loading inside the application.
The runner honors an `output-root/STOP` file between polls and guards C: against
more than 128 MiB additional free-space loss (including OS paging).

Keep this workload quiet: no simultaneous tests/builds/other measurement browser.
Boot is a new HTTP profile, not a cold OS/driver cache. A broker-free startup is
not the public site's connection latency. Check actual loads and repeated-run
spread before calling a small difference a gain.
