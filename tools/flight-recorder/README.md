# Flight recorder: motion capture of the bomber squadron

Motion quality (curves, banking, entry from the screen edge) cannot be judged from single stills. This
recorder plays the `inspectorUltimates` dev scenario in headless Chrome at the real player camera
(1920 × 1080, zoom 1). It steps 60 Hz scenario frames deterministically and writes, per variant:

| File | Content |
|---|---|
| `flight__<variant>.webm` / `.gif` | 30-fps video (gif at 960 px) |
| `board__<variant>.png` | Stills plus 1:1 crops of one drone |
| `paths__<variant>.png` | Base corridor vs. chosen corridor, drop points, view at activation |
| `report.json` | Per-frame poses, visibility, impacts, fade fallbacks |

```bash
node tools/flight-recorder/record.mjs --variant full-night
# or: npm run record:flight -- --variant cluster-day
```

| Flag | Meaning |
|---|---|
| `--variant a,b` | `base-day`, `base-night`, `full-day`, `full-night`, `cluster-day` (default all) |
| `--port <n>` | Vite port (default 8099; 8080 and 8090 are refused) |
| `--out <dir>` | Output folder relative to the root (default `build/flight-recorder`) |
| `--root <dir>` | Checkout to serve (default: this checkout) |

FFmpeg is looked up in this order: `FFMPEG_PATH`, then `ffmpeg` on `PATH`, then known local installs.
A full run takes about half an hour; a single variant takes a few minutes.

Other flying or moving effects can use the same structure: `install()` (observation hooks), `sample()`
(per-frame trace), the video encoder and `board()`/path plots. Copy the recorder and swap the scenario
commands and the sampled data.
