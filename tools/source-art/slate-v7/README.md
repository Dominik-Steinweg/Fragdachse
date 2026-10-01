# V7 mineral material sources

## Mineral D – independent chipped grain

`mineral-source-d.png` is a newly generated neutral material without large plane outlines. Aligned A/B/C experiments stamped the same shapes too visibly. D supports an independent geometric period (512 world pixels) while retaining existing 256px material phases. Built-in ImageGen prompt:

```text
Use case: stylized-concept. Asset type: seamless PBR diffuse mineral colour texture for an orthographic top-down 2D woodland rock formation, opaque square.
Create a premium artist-authored weathered grey schist/slate surface, a continuous sheet of natural chipped mineral strata seen directly from above. This is a FLAT ALBEDO MAP. No shading based on face orientation, no cast shadow, no dark sides or light top faces. NOT a collection of separate boulders, NOT paving/cobblestones, NOT large low-poly blocks, NOT a mountain relief. Mid-grey neutral slightly blue pigment approximately #686e75 across the whole tile. A balanced hierarchy of calm mineral patches, irregular broken fine layers and narrow fractures. Rich small and medium weathering: numerous organically chipped laminae between 10 and 45 source pixels wide on a 1024 tile, with occasional quiet patches around70px. A few subtle pale mineral flecks, dark hairline fissures, rare warm grey inclusions. All relief cues kept shallow and nondirectional; detailed flake edges never outlined white or black. Natural irregular grain should feel hand-selected, not repetitive foam, leather, scales or noise. No continuous dominant diagonals, no rows, no tessellated main-face outlines.
The final tile will be reduced to256 world pixels, so prioritize tasteful clearly legible medium-scale detail over microscopic noise. No moss or plants because the game adds its existing green vegetation. No baked sunlight, spotlight, gradient, shiny wet reflection, vignette, border or text. Seamless left-right and top-bottom edges. Realistic stylized craft comparable to detailed pre-rendered top-down forest strategy-game stone, with gentle neutral diffuse texture only.
```

Built-in ImageGen, 2026-09-29. D is the selected runtime material. The selected D export uses a separate 512-world-pixel weathered relief, seed 74931, and a 256-world-pixel colour period. Runtime height remains reproducible from `scripts/lib/slate-v7-geometry.mjs`.

Rebuild with `node scripts/export-slate-v7.mjs`. The exporter produces a 1× fallback and a 2× colour atlas with identical normalized frame rectangles and nearest-replicated baseline coverage; 2× preserves more of D's generated mineral grain. Atlas extrusion, material phases, exact baseline coverage and independently authored height are checked by `tests/assets/SlateV7.test.ts`. Export hashes and chosen geometry parameters are stored in `public/assets/environment/woodland/rock/mineral.json`.
