# Turret materials — towers-r03

The second material pass replaces the broad saturated enamel/plastic appearance
with warm brushed/cast metal, broken paint, deeper assembly seams and an earthy
support with moss stains. Wear is authored at medium scale so it survives the
40px mechanical / 32px fungal display size. Cyan, violet and ochre remain on
functional contacts and small identification panels. The mushroom uses dry
terracotta skin; the pressure reservoir uses a muted matte frost surface.

`turret_surface_parts.py` evaluates the finish in each part's generated space,
so the marks follow existing firing motion. `turret_parts.py` desaturates the
large armor panels without changing energy materials. Existing bolts, straps,
grilles and panel boundaries provide the construction detail. Wood and cloth
were not added to metal pressure tanks or electrical carriers. No new runtime
shader, material pass, texture lookup or ground-shadow layer is needed.

Baseline is main's eight `towers-r01` mechanical assets and the `towers-r02`
mushroom: the r02 source directory contains only that corrected fungal asset.
The source recipes, packed technical/organic textures and all animation controls
are retained. All nine new selections use `towers-r03`, with the same source
resolution, canvas, pivot, display size, frames, timing and muzzle sockets.
The camera remains orthographic, exactly down -Z; lights and geometry are fixed.
All 93 evaluated poses match the main baseline. Alpha is byte-identical for all
18 PNGs. Decoded RGBA allocation stays at 14.117 MiB (+0%, below the +25% budget).

Local production sources: `D:/Fragdachse-render/towers-r03/`, mirrored from
`D:/Fragdachse-render/jobs/towers2/art/poc/pipeline-v2/runs/towers-r03/`.
Each asset retains all 1024px masters, the packed Blend/Actions, input snapshots,
independent Blender verification, comparison inputs, review, selection and an
immutable `source-bundle.zip`. Rebuild through the documented V2 pipeline using
a fresh revision. Existing sources and selected archives must not be overwritten.

Review: `D:/Fragdachse-render/towers2-review/index.html`. It contains before/after
sheets at 1x and 2x, optional 4x construction inspection, and actual Map 1 views
at noon, 17:00 and midnight alongside rocks and vegetation. Sizes describe CSS
pixels per world pixel, not merely the camera's internal zoom parameter. Rotated
poses and two actual Phaser firing phases are also captured. The review is for
visible material improvement; the Blender/alpha checks establish pose parity.

Tradeoff: the housings are more neutral and visibly weathered; weapon colors are
concentrated in smaller areas. Fine grain still disappears at 1x, while the broad
metal/paint value groups remain. At night material detail depends on existing
world light and the flashlight. Baked seam AO does not replace world shadows.

Only the existing `towers` visual-reference group is updated. Train references
are deliberately outside this job. Verification reports and memory measurements
are retained with the local review, with the concise handoff in
`C:/Fragdachse/build/codex-queue/towers2.md`.
