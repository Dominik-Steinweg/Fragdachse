# Late join: real two-browser replication check

Host A starts the normal game in headless Chrome and registers a real PeerJS room. It prepares a
dev scenario, activates a deployment, and plays forward. Then a fresh client B joins through `#r=<room>`
over real WebRTC. Both peers are compared at three points: after the join, in the middle and at the end.

```bash
node tools/latejoin/latejoin.mjs
# or: npm run latejoin -- --phase bomber
```

| Flag | Meaning |
|---|---|
| `--root <dir>` | Checkout to serve (default: this checkout) |
| `--port <n>` | Vite port (default 8099; 8080 and 8090 are refused) |
| `--out <dir>` | Output folder relative to the root (default `build/latejoin`) |
| `--phase a,b` | Phases to run (`holo`, `bomber`; default both) |
| `--offline-smoke` | Host-only smoke run of the scenario attachment; it **never** counts as a late-join pass |

Requirements:
- **Network:** the PeerJS broker must be reachable. Sandboxes without network fail at host
  registration, and the error is reported.
- **Port:** the port must be free. Do not run the tool in parallel with captures on the same port.
- **Chrome:** set `CHROME_PATH` when Chrome is not installed at its default Windows location.

## What it checks
- **Real session:** both peers hold an open WebRTC link (reliable and fast channel) in the same room
  with different player IDs.
- **Bootstrap:** the reliable full snapshot carries the relevant wire slice (`fc` kind 2 for Holo,
  `bq` for the bomber).
- **Replicated facts:** they are equal on both peers.
  - Holo: deployment IDs and copy `seq`.
  - Bomber: squadron, anchors and `stoppedAt`.
- **No replay** (bomber): impacts before the join point are not shown again on B. Every explosion on B
  matches a planned host drop.
- **End:** both slices are empty, and there are no page, console or HTTP errors.

Results go to `<out>/latejoin-result.json`, with screenshots per peer and checkpoint.

## How it works and how to extend it
- **Clock:** host A's dev-scenario controller prepares the fixture. Before B is created, the
  controller is detached. From then on its `ScenarioClock` drives normal host frames only, and B's
  `Date.now` follows the host epoch. Wall-clock latency is **not** tested.
- **Instrumentation:** `browserHarness()` is served as the page entry before `src/main.ts`. It only
  observes: it wraps presentation ports and reads `bridge` getters. It replaces no gameplay or network
  code.
- **New feature:** add a phase name to `PHASES`. Add a `prepare`/`activate` route in your dev scenario,
  then define its facts function (like `holoFacts`/`bomberFacts`) and its join point in `runPhase`.

The replication contracts themselves are in [`docs/ai/networking.md`](../../docs/ai/networking.md).
