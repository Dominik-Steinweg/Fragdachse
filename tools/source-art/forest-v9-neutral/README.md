# Woodland canopy sources

The 16 native `canopy-v9-0.png` through `canopy-v9-15.png` files are the canonical, neutralized authored crowns. `selection.json` maps indices to species/source IDs. Their four 512px material images (albedo, normal/AO/thickness, two horizon sets) are exported unchanged by `scripts/export-forest-v9.mjs`.

`derive.mjs --verify` verifies reproducibility from native sources; without the flag it regenerates the material images. Versioned coverage and material contracts live in `tools/source-art/forest-canopy/`. Data alpha is thickness or a horizon, never opacity; do not premultiply it.

Generation prompts, selected-source metadata and neutralization measurements remain in `mass-prompts.json`, `mass-sources.json`, `mass-metrics.json` and `mass-parameters-balanced.json`. The original generation used bounded RGB neutralization, preserving alpha and leaf positions; it is an artistic approximation rather than measured geometry. Untracked raw candidate folders are not runtime/export dependencies.
