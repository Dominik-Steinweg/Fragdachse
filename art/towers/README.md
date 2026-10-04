# Weathered turret surfaces

The nine turret sprites retain their geometry, canvas, pivot, source resolution,
frame mapping, timing, sockets and display sizes. `turret_surface_parts.py` adds
part-local albedo variation, interrupted paint wear, restrained iron/copper
oxidation, roughness, microscopic bump and warm contact dirt. The fungal surface
keeps its authored cap/scales and gains dry cuticle granulation. Existing energy
materials and the common soft lighting are preserved.

No wood, cloth or stone has been painted onto parts that were authored as metal.
No new runtime shader, texture lookup or ground-shadow layer is needed. The
contact AO is baked between model parts; it does not replace world shadows.
Separate albedo/normal passes and runtime form lighting are deferred.

Selected sources: `towers-r01` for eight mechanical turrets, `towers-r02` for
`spore`. Each selected run has `review.json`, `selection.json`, all 1024 masters,
a packed Blend, source snapshots and `source-bundle.zip`. Local runs are under
`D:/Fragdachse-render/jobs/towers/art/poc/pipeline-v2/runs/`; the first also has
the authoring entry `D:/Fragdachse-render/towers-r01/`. Review PNGs, including
all three times of day and 1/2/4 actual screen pixels per world unit, are under
`D:/Fragdachse-render/towers-review/`. The isolated scenario uses production
turret sprites/animations and world lighting on the asset viewer's rock supports.

All 93 evaluated poses match the previous meshes, camera, lights and empty/socket
transforms; exported idle and sheet alpha is byte-identical. The independent
Blender verifier checks every asset, and a rocket frame was rendered on CPU from
an extracted source archive. Dark beauty pixels in occluded apertures remain
valid; the finite/coverage pass gate is applied without treating beauty as albedo.

Decoded RGBA texture allocation remains **14.117 MiB**, an increase of **0 MiB**.
Source PNGs total **1.242 MiB**, previously **1.084 MiB**. Runtime publication
uses the existing lossless colour pipeline (**1.117 MiB**, previously **1.013 MiB**).
No gameplay or production lifecycle code changes.

The existing visual runner adds only the `towers` group (day/dusk/night).
`devScenario.run({action:'turretMaterialReview'})` arranges all unique turrets
around the current target. The fixture temporarily hides cosmetic wildlife and
its pulsing lamps, restoring it when the gallery ends. Observer/HUD masks stay
outside all turret canvases. World lighting and the flashlight remain active.
Only the three new reference images are recorded. Existing scene recipes and
image hashes were checked unchanged before advancing the global catalog hash.
Three consecutive runs of the new gallery match all three references exactly.
`npm run check` passes 4,928 core and 54 architecture tests plus both builds;
`npm run test:assets` passes all 180 tests. Full-suite visual results and the
independent Blender reports are retained in the review folder's `verification/`.

Rebuild with the documented V2 commands and a fresh revision, using the existing
packed technical/organic texture sources. Selection requires a new review;
completed runs and their archives must not be overwritten.
