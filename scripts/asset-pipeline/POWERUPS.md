# Layered power-up authoring (V2)

This is an additive V2 family with a separate demand catalog `powerups-v2.json`.
The main gameplay asset catalog and existing selected icons remain unchanged.
`powerup` is a static V2 category without weapon sockets or animation clips.
The recipes use the shared `blender_pipeline_v2.prepare`, camera/light/material helpers,
evaluated-mesh clipping checks, 1024 master contract, alpha-aware `exportVariantV2`
and the existing V2 source archive format. No image generation is used.

## Recipes and materials

- `recipes_v2/powerup-base.py`: one rounded grey stone/metal foundation, recessed face,
  softened rim, four restrained edge scuffs. No symbol, icon-specific stain or shadow
  is baked into this common layer.
- `recipes_v2/powerup-symbol.py` dispatches eight independent authored models through
  `powerup_parts.py`: crimson cross, amber shield, red/coral flame, diagonal blue syringe,
  lime orb, paired magenta open blades, brass holy grenade with cross and red seal,
  yellow radiation medallion with exactly three charcoal lobes and a central dot.
- Closed relief meshes, bevels, broad matte surfaces and low-amplitude procedural wear;
  existing `technical.png` supplies restrained material variation. No black cartoon
  stroke, ground plane, external drop shadow, mirror metal, additional overhead lamp
  or image-plane projection of the old icon.
- Power-up-local r02 light rig: NW area key 650 W / size 3.2, soft fill 75 W / size 5,
  ambient strength 0.16, unchanged Standard view transform. Other beauty assets retain
  their shared light rig. Satin enamel uses roughness 0.34, restrained coat/specular,
  edge normals and more saturated base colours. Source images
  describe identity and silhouette, not fixed lighting baked into the new materials.

Approved reference symbols are actually in `art/icon-refresh-a03-a14/r03/layers/`;
`r05/layers/` contains the common background only. The catalog uses exact selected
paths/hashes from `final-manifest.json`. Those references, the original prompts and
README are preserved in the new source snapshot and archive.

## Layer contract

All models use orthoScale 2.2, fixed pivot `(0.5,0.5)`, camera rotation `(0,0,0)`,
X right / image Y south, Blender Z up. Each pass has the same transparent square canvas;
never trim, recenter or fit by alpha bounds. Source exports are 128 and 256 pixels,
both directly from 1024 masters. The V2 22-pixel export is diagnostic.

The runtime handoff uses 256-pixel layers: one base and eight symbols. Display both at
22 world units, then multiply only the symbol's fitted scale by 0.92–1.08 around its
shared center. Never scale the base or replace the fitted scale with a raw tween value.
The base's occupied width is 1.94/2.2 of the canvas, or 19.4 world units; the authored
symbol footprint remains inside the base's safety margin at 1.08. The r02 base has an
explicit broad chamfer and a recessed 1.56-unit center; symbol tips may overlap its rim.
The 22-unit canvas contract is unchanged.
No additional render frames are necessary for this simple runtime pulse.

Eight 256-pixel UI composites are assembled from the exported base plus symbol at 1.0,
using ordinary source-over alpha. Their pixels are verified against those same layers;
there is no separately lit combined render that would disagree with the runtime pulse.
Layer alpha is coverage, not data; all PNGs are straight sRGB RGBA. The raw V2 exports
retain geometry/self shading. `powerup-symbol-finish.mjs` adds a fine dark colour-derived
edge (2–3 source pixels) and short SE contact shadow (offset 3/5 pixels, blur sigma 3,
opacity 0.42) to each final 256-pixel symbol layer. This is an offline alpha silhouette
contact approximation, not a Blender shadow-catcher pass. It scales with the symbol;
the common base contains no symbol shadow. Raw exports remain archived, and the bundle
validator recomputes final symbols and composites byte-for-byte. The finishing method
and raw source hashes are explicitly bound; historical r01 bundles remain readable.

`powerups-manifest.json` records game IDs, existing sprite keys/reference paths, shared
pivot/scale, filenames, SHA-256, download bytes and GPU bytes. Layer-only RGBA8 memory
is 2,359,296 bytes (2.25 MiB); including every UI composite is 4,456,448 bytes (4.25 MiB),
without mipmaps. These textures are shared by all pickups.

## Claude's command

```powershell
# Read-only source/hash checks; no Blender or file output:
node scripts/asset-pipeline/powerups-run.mjs --plan --revision powerups-r02
# Complete render/export/review/archive run:
node scripts/asset-pipeline/powerups-run.mjs --revision powerups-r02
```

Default: `D:/Blender Foundation/Blender 5.2/blender.exe`, headless OPTIX. `--device CPU`
or `--device CUDA` is explicit; no silent GPU fallback. New revision required on rerun.
All source copies, renders, blend files, cache, intermediate exports and archives stay
under `D:/Fragdachse-render/powerups-r02/`. The 9 models render only once each, at 1024.
The runner uses a source snapshot, rejects input drift and verifies the original V2
export/alpha contracts. It creates `selection.json`, `source-bundle.zip` with archive
manifest, then verifies every ZIP member/hash and records `archive-receipt.json`.
The selection means a technically complete candidate; status is `rendered-awaiting-review`,
not visual approval. Failed revisions remain for diagnosis and are never overwritten.

Four review PNGs and review metadata are also copied to
`build/powerups-blender/review/powerups-r02/`:

- `old-new-game-size.png`: all eight old/new on the current forest floor at 22×1.4 pixels;
  a 16×1.4 column checks the smaller countdown/UI use.
- `old-new-36px.png`: exact 36-pixel old/new/symbol canvases on forest ground.
- `symbol-pulse-fixed-base.png`: 0.92 / 1.00 / 1.08 at 36 pixels, identical base.
- `old-new-detail.png`: 128-pixel old/new/symbol for material and edge inspection.

Reviews are copied before final archival validation so a later failure cannot hide them.
Blender float32 projection values use a finite absolute tolerance below 1e-5.
Static key states do not verify temporal animation or browser/GPU rendering. No browser
or dev server is used. Expected OPTIX wall time: roughly 1–3 minutes, not yet measured;
inspect the actual output before accepting colours, wear and silhouette.

## Prepared runtime import — not part of this authoring run

```powershell
# Read-only verification and destination preview:
node scripts/asset-pipeline/import-powerups.mjs D:/Fragdachse-render/powerups-r02
# Later, only in the integrating session:
node scripts/asset-pipeline/import-powerups.mjs D:/Fragdachse-render/powerups-r02 --apply
```

Targets: `public/assets/sprites/pipeline-v2/powerups/powerups-r02/` and
`src/assets/manifests/powerups-powerups-r02.json`. Existing 16x16*.png icons and active
registries are never replaced. Filenames carry content hashes and URLs use `?v=sha256`;
Spur A can resolve logical filenames through A2/A3 publication. Import copies bytes,
rechecks them, and leaves animation/depth/loading and reveal-fit integration to Spur A.
No publication or project checks run without that explicit later command.

## Scoped checks

```powershell
& 'D:/Blender Foundation/Blender 5.2/blender.exe' --factory-startup -b --python-exit-code 1 --python scripts/asset-pipeline/powerups-blender.py -- --validate-only --repo C:/Fragdachse
git apply --check build/powerups-blender/pipeline-tests.patch
git diff --check -- scripts/asset-pipeline
```

The Blender check builds all geometry/material graphs in memory and validates base,
pulse bounds and camera without rendering or saving. Proposed asset tests are delivered
as a patch to respect the parallel-session file boundary. They cover roster/pivot,
V2 static-manifest compatibility, fixed-base compositing and unchanged player beauty.
No repository `npm run check`, build, browser or test-hook pipeline is invoked here.
