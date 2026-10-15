# Capture kit: labelled dev-scenario boards

One command per spec. It starts its own Vite server, runs headless Chrome, plays the scenario with
deterministic 60 Hz frame stepping, and writes native PNGs, crops, one labelled board per variant,
and a JSON log.

```bash
node tools/capture-kit/capture.mjs tools/capture-kit/examples/firestarter.json
# or: npm run capture -- tools/capture-kit/examples/firestarter.json
```

Options:

| Flag | Meaning |
|---|---|
| `--root <worktree>` | Checkout to serve and capture (default: the checkout that contains this kit). Tooling (vite, playwright-core, sharp) is resolved from that checkout, and output goes to its `build/`. |
| `--port <n>` | Vite port with `--strictPort`. Default: `CAPTURE_PORT`, else the `--root` worktree's port from the shared registry (`npm run worktree:new` assigns one), else the first free port from 8098. **8090 is refused** (reserved for a foreign process). Parallel runs need different ports. |
| `--out <dir>` | Output root instead of `<root>/build/capture-kit/out` (also `CAPTURE_OUT`). |
| `CAPTURE_TIMEOUT_MS` (env) | Playwright's per-page default timeout, default 180000; raise it on a loaded machine. |
| `--layout map00,map04` / `--time day` | Run only some variants (ids from the spec). |
| `--keep-going` | Continue with the next variant after one fails (default: stop). |
| `--headed` | Visible Chrome window, for debugging. |
| `--fresh-tabs` | Reload the page for every variant. By default, consecutive variants of the same layout reuse the tab and restart the scenario (`devScenario.run({action:'start'})`), which skips module/asset loading. |
| `--probe <mapId>` | No spec needed. Boots the map and writes a free-cell ASCII map (`freemap__*.txt`, `.` free / `#` blocked / `P` default spawn) plus a gridded overview, so you can pick coordinates. |

Lifecycle: Vite runs in-process with `host 127.0.0.1`, `strictPort`, **no HMR and no file watcher**
(concurrent `src/` edits never reload a running capture; the next run picks them up). Chrome is the
installed one (`CHROME_PATH` overrides; otherwise the usual install locations, then Playwright's `chrome` channel). It starts headless with `--disable-background-timer-throttling
--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --force-color-profile=srgb`, using
a temporary profile under `<root>/build/capture-kit/.tmp/`. Chrome, Vite and the profile are always removed in
`finally`, also on errors and Ctrl+C. `log.json.profileRemoved` confirms the removal. The Vite optimizer
cache stays in `.tmp/vite-cache` (safe to delete).

Output: `<root>/build/capture-kit/out/<spec-name>/<timestamp>/` (ignored by git)

- `<variant>__NN-<shot>.png`: unscaled viewport screenshot (canvas at DPR 1, panel hidden).
- `<variant>__NN-<shot>__cropK.png`: crop, upscaled with nearest-neighbour, no colour change.
- `board__<variant>.png`: header (spec, map, fixed time, seed, commit, dirty `src` count) plus a labelled tile per shot and crop.
- `log.json`: per variant the scenario, timings, console errors/warnings, page errors, HTTP ≥ 400, warnings;
  per shot a **host snapshot** (`host`), a trimmed `devScenario.status()`, the `until` frame counts and the crop rectangles.
- `<variant>__error.png` and `errorStatus` in the log when a variant fails.

## Spec format

```jsonc
{
  "name": "firestarter",                 // output folder; default: file name
  "viewport": { "width": 1280, "height": 720 },
  "board": { "columns": 4, "tileWidth": 560 },
  "hud": false,                          // hide the clarity camera (HUD, player rings, crosshair); default true
  "scenario": { ... },                   // dev-scenario recipe fields (docs/dev-scenarios.md), "$var" allowed
  "times":   [ { "id": "day", "timeOfDay": 720, "label": "12:00" }, { "id": "night", "timeOfDay": 1320 } ],
  "layouts": [ { "id": "map04", "scenario": { "mapId": "4" }, "vars": { "player": { "gridX": 38, "gridY": 27 } } } ],
  "vars": { },                           // shared variables; layout vars override
  "warmup": [ ops ],                     // optional, before the standard warm-up
  "warmupFrames": 120,
  "setup":  [ ops ],                     // after warm-up; the time mark starts here
  "shots":  [ { "id": "commit", "label": "lance commit", "do": [ ops ], "crops": [ crop ] } ],
  "chromeArgs": [ ]                      // extra Chrome flags
}
```

**Variants** are `layouts × times`, with the id `<layout>-<time>`, ordered layout by layout. The first variant of a layout loads the page. Later times of the same layout restart the scenario in that tab; a failed variant always gets a fresh tab next. The recipe is
`{version:1, seed:12345, classId:'inspector_gadachs', hideAim, hideTutorial, suppressWaves, freezeMission: true}`
plus `scenario`, `layout.scenario` and `timeOfDay`. The page uses `?visual-test=1`, which pins
`Math.random`/`Date.now` and starts paused with fixed 1000/60 ms frames.

**Time of day is fixed.** The scenario controller applies `timeOfDay` every host frame as a debug
override, even on maps with `dynamicTimeOfDay` (map 00: 24 min/s; map 15: boss transitions). The kit reads
the actual minute for each shot (`host.timeOfDay`) and warns on drift.

**Variables.** A string that is exactly `"$name"` is replaced by `vars.name`, at any depth (positions, zoom,
booleans). This lets a single shot list serve several maps.

### Ops (used in `warmup`, `setup` and `shot.do`)

| Op | Effect |
|---|---|
| `{ "action": ... }` | Any `devScenario.run` command, unchanged (`target`, `teleport`, `clearEnemies`, `options`, `fire`, `build`, `renderDebug`, `figureSun`, …). `step`/`settle` wait until drained. |
| `{ "op": "step", "frames": N }` | Exactly N simulation frames at 60 Hz. |
| `{ "op": "ms", "ms": 250 }` | Rounded to whole frames (`round(ms*60/1000)`). |
| `{ "op": "until", "expr": "...", "maxFrames": 900, "every": 1, "optional": false }` | Step one frame at a time until the JS predicate is true. It is checked before each step, so 0 frames means it was already true. On timeout the variant fails, or only warns with `optional:true`. |
| `{ "op": "spawn", "kind", "at": {gridX,gridY}, "pinned", "hp", "allied", "name" }` | Hostile spawns use `devScenario.run({action:'spawn'})`. `allied:true` uses the host's ally path (`EnemyManager.hostSpawnAllyAtWorld`, the same one necromancy revives use) through the navigation-lab port. `name` makes it addressable as `e.<name>` / crop / camera target. |
| `{ "op": "camera", "at": {gridX,gridY} \| "follow": "<name>\|player", "zoom", "offset": {gridX,gridY} }` | Moves the scenario target and focuses the camera on it. Note: the target is also the player's aim point. |
| `{ "op": "mark" }` | Resets the time origin for labels (`t+… ms (f+…)`) and `host.sinceMarkMs` / `explosionsSinceMark`. |
| `{ "op": "settle" }` | Processes worker/render work at zero simulation delta. This also runs automatically before every capture. |
| `{ "op": "hud", "visible": false }` | Shows or hides the clarity camera. |
| `{ "op": "js", "code": "..." }` | Escape hatch: async body with `ck`, `dev` (= `window.devScenario`) and `host` in scope. |

### `until` predicates

The expression runs in the page with `host` and `e` (= `host.named`). `host` is a read-only host snapshot:

- `now` (synchronised host ms; this is the clock that game timestamps such as `armedAt` and `commitAt` use), `simulationMs`, `sinceMarkMs`, `timeOfDay`
- `enemies[]`: `EnemyEntity.getNetSnapshot()` (kind, faction, x/y, hp, `specialAction`, `specialActionEndsAt`, `burrowed`, `dashPhase`, …) plus `name`, `grid`, `pinned`, `alive`, `firestarter` (lance `{target,startedAt,commitAt,endsAt}`, `lastAttack`, `charges`) and `mortarStrikes` for that enemy
- `named.<name>`: the same entry for an enemy spawned with `name` (`{alive:false, gone:true}` once removed)
- `mortarStrikes[]` (`armedAt`, `launchAt`, `impactAt`, `targetX/Y`, `faction`)
- `explosions[]` / `explosionsSinceMark[]`: every presented explosion `{style, x, y, radius, simulationMs, grid}`, logged by wrapping `EffectSystem.playExplosionEffect` (styles include `mortar`, `firestarter_combo`, `default`, …)
- `burningCells`, `meteors`, `lights`, `player`, `camera`

Examples: `e.fs.specialAction === 'fire-lance-charge'`, `host.now >= e.fs.firestarter.lance.commitAt`,
`host.explosionsSinceMark.some(x => x.style === 'mortar')`, `host.mortarStrikes.length > 0`.
A new enemy (e.g. the shield charger) needs no kit change if its state appears in `getNetSnapshot()`
(`specialAction`) or in the explosion log. Anything else can be read with a `js` op or an expression on `ck.dev.runtime`.

### Crops

`{ "of": "<name>" | "player" | {gridX,gridY}, "size": [w,h] | N, "scale": 3, "offset": [dx,dy], "label": "..." }`.
The rectangle is in screenshot pixels around the entity's current screen position, clamped to the frame,
and upscaled by `scale` with nearest-neighbour. The world→screen mapping honours the arena camera's (0,0) origin.

## Maps and colour grade

The world grade turns **violet** (`isVoidMap`) on map **15** and on every map with `trackMode: "void-fire"`:
**00 (`00-test`), 16, 17**. Map 15 also has a boss-profile grade. All other campaign maps (1–14) have a
neutral grade, which makes them the right choice for judging colours. Example specs run on **00**
(encounter test bed, violet) and **04** (neutral, open meadow around rows 24–28).

To find free positions on a new map: `node tools/capture-kit/capture.mjs --probe 4`, then read
`out/probe-map4/<ts>/freemap__map4-day.txt`. Spawns into blocked cells fail with "Ziel ist blockiert".

## Examples

- `examples/firestarter.json`: lance telegraph (+150 ms, ×3 crop), commit (×3 crop), shot, shot +150 ms,
  orb volley, combo telegraph, combo impact, +300 ms (shooter removed), +1200 ms. Combo recipe: a stationary player is
  hit by the close shooter's orbs before any lance reaches them. So after the volley, the close shooter is removed
  (its orbs keep flying) and a **pinned** second shooter about 976 px away on the same side is spawned. That is
  outside direct lance range (950) but in range of the orb next to the player. Its first scan lances that orb.
  Note: the plain orb impact *also* uses style `firestarter_combo` (radius 48); the real combo has radius 125,
  hence `x.radius > 100`.
- `examples/mortar.json`: windup 10/50/90 % (from `mortarStrikes.armedAt/launchAt`), launch, flight 50 %,
  impact (`mortar` explosion), +250 ms, +700 ms. The mortar must stay **unpinned**: it only fires after it reaches
  its chosen siege position, so a pinned mortar never starts a windup (the `until` times out).

Both run `map00` and `map04` at 12:00 and 22:00.

## Limitations

- Boot dominates. Loading a page until `ready` takes about 45–65 s on map 04 and 110–135 s on map 00 (400×80 cells, the
  largest world). A same-tab restart only rebuilds the world. Shots plus board take about 10–20 s per variant.
  Use `--layout/--time` while iterating.
- A same-tab restart continues the simulation clock (`simulationMs`, `Date.now`), so absolute times differ from a fresh
  tab. The reseeded effect randomness and every relative time (`t+…`, `until` frame counts) stay comparable.
- Determinism covers the simulation, `Math.random` and `Date.now`. Worker results land on wall time and
  are settled at zero delta before each capture, so tiny differences between runs are possible
  (see `scripts/visual/run.mjs` for the strict freeze-check variant).
- Host hooks (`__ck`) reach internals by name (`ArenaScene.devScenario`, `runtime.flow`,
  `CoopDefenseFirestarterSystem.states`, `EffectSystem.playExplosionEffect`). A renamed field fails loudly
  at "installKit" or yields `null`, never silently wrong images.
- The camera `op` moves the scenario target, which is also the player's aim point. Pinned enemies keep their AI
  and attacks. Unpinned enemies may reposition and leave the frame; `camera.follow` re-centres on demand.
- Only the local host is captured; there is no client-side replication view.
