---
name: fragdachse-phaser
description: Apply Fragdachse's local Phaser 4 conventions with minimal context. Use for changes involving Phaser APIs, ArenaScene, scenes, HUD or overlays, rendering, cameras, particles, tweens, input, audio, filters, textures, or other visual game behavior. Do not use for pure gameplay, network, data, or configuration changes without Phaser behavior.
---

# Fragdachse Phaser

Use the project rules from `/AGENTS.md` and keep investigation proportional to the task.

## Workflow

1. Search the affected symbol and nearby local abstraction with `rg`; inspect `src/ui/`, `src/effects/`, `src/scenes/`, or `src/utils/phaserFx.ts` as appropriate.
2. Reuse existing texture helpers, renderers, UI patterns, depth constants and FX utilities before introducing a wrapper.
3. For an uncertain Phaser API, search the exact symbol under `node_modules/phaser/types/` or `node_modules/phaser/src/`. Read only the matching definition and nearby documentation.
4. Implement with Phaser 4 APIs. Reject Phaser-3-only examples unless the task explicitly concerns migration.
5. Keep authoritative gameplay state outside renderers and UI. Scenes orchestrate; renderers and effects visualize.
6. Apply the proportional verification matrix from `/AGENTS.md`. Perform a visual check only when visible behavior changed.

## Local conventions

- Import Phaser with `import * as Phaser from 'phaser'`.
- Prefer `src/utils/phaserFx.ts` for filters and FX behavior.
- Prefer crop, bounds or visibility checks over scene-wide WebGL geometry-mask assumptions.
- Preserve established texture keys, depth ordering, pixel-art settings and cleanup in destroy/teardown paths.

