# Enemy mesh R0/R1 — isolated pipeline

## Offline material preparation for all selected enemies

`npm run assets:prepare-enemy-materials -- --out D:/Fragdachse-render/<new-revision>`
resolves all 14 enemies from the catalog and current mesh manifests. It verifies
selected sources, archives, Blend, masters, sheets and pose/pivot mapping before
copying Beauty/Albedo/Normal/separate Emission to D:. AO stays in normal alpha.
Every master and published source size is checked. Runtime registration is unchanged.

`--verify <prepared-directory>` rechecks the catalog, source/output/tool hashes
and all master pixels. `--jobs 2` bounds independent CPU/I/O work. Source revisions
and prepared directories are immutable. Missing historical EXRs are reported by
`audit_float_sources.py`; PNGs cannot establish their pre-encoding float validity.

Confirmed albedo corruption can be rerendered from the original camera/seed:

```powershell
& 'D:/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup --python-exit-code 1 --python scripts/asset-pipeline/enemy_mesh_family_render.py -- --job D:/Fragdachse-render/enemy-mesh-r1-010/zombie-badger/job.json --frames 2 --output D:/Fragdachse-render/<new-repair>/zombie-badger
npm run assets:prepare-enemy-materials -- --out D:/Fragdachse-render/<new-preparation> --repairs D:/Fragdachse-render/<new-repair>
```

The repair must match the archived render Blend and pose. Only corrected Albedo
masters and their sheet tiles are adopted. Coverage must be exactly equal; colour
changes must stay within corruption bounds plus four filter pixels. At most one
unrelated RGB8 pixel may differ by one code value between independent Cycles runs;
this is explicitly reported. Larger changes fail. Other frames, Beauty, Normal/AO
and Emission retain their pixels. No importer is called. See [PIPELINE-AUDIT.md](PIPELINE-AUDIT.md).

## Historical pilot contract

Pilots: Zombie and Rabid, selected `v2-claw-leap-a` sources. No player-r3 module,
recipe, registry, public asset or runtime code is changed. Other enemies retain
their original recipes. Import belongs to R3 after review.

## Contract and provenance

- `enemy-mesh-contract.mjs`, `enemy-mesh-pilot.json`, `enemy-mesh-sources.mjs` pin
  selected Blend, source archive, render metadata, every master and public sheet
  by SHA-256. Missing or ambiguous anatomy fails explicitly.
- 31 poses: P0 rest, P1–12 move, P13–30 claw. Preserve source times, clip frame
  rates, strike/impact markers, canvas, centered pivot and atlas layout.
- Zombie: 67.2 world px / 6.72 Blender units = 10 px/unit.
  Rabid: 52.8 / 7.296 = 7.2368421053 px/unit. No player scale constants.
- Axes `(X right, Y south, Z up)`; source conversion `(x,-y,z)`. Evaluated geometry
  already includes attack-root Z. Never add the jump a second time.
- One fixed index buffer and vertex order/type; 1,000–2,000 vertices, at most
  4,000 triangles. Pose-major U16 XYZ in all-pose bounds, little-endian U16 indices.
  Check byte counts, hashes, finite bounds and decoded index ranges.
- Four paw anchors/pose: evaluated centroid XY/minimum Z. Contact fades over
  1.5 world px relative to that paw's rest minimum. Presentation metadata only.

## Source repair

`enemy_mesh_anatomy.py` retargets existing proximal root weights of four muscles
and four fur objects to a WORLD-space body-follow bone, accounting for the pounce
parent once. Other visible objects retain identical evaluated positions at every
checked time: 195 Zombie objects and 67 Rabid objects.

Weights alone leave gaps. Four closed muscle sleeves connect declared body-interior
and proximal-muscle anchors: 38 source vertices/72 triangles each, with absolute
shape keys at original and quarter-phase times. These are real Beauty geometry
in the saved Blend. No sleeve connects separate toes or armour. The shadow version
can omit redundant middle rings/cap centres without changing the sleeve volume.
Actual renders independently reopen the persisted repaired source.

## Geometry checks

- `enemy_mesh_corridor.py`: four explicit body-to-leg corridors; original anchors
  frozen for A/B, five probes across 0.5 world px. Other legs cannot hide a source
  attachment gap. Gate centreline gaps >0.25 world px and endpoint coverage;
  side probes report area. This is not a blanket silhouette hole-closing operation.
- 118 samples: 31 exported and 87 quarter phases, including the move seam.
  16 azimuths × 20/28/35/45/60 degrees plus top view: 38,232 source probes/type.
  The actual decoded export receives another 10,044 leg/view probes/type.
- `enemy_mesh_export.py`: fixed rest approximation, source-triangle bindings and
  quantization. Zombie uses part simplification and narrowly inset coat envelopes.
  Rabid uses `enemy_mesh_union.py`: fine rest volume, closed thin fur cards, source
  bindings and fixed edge refinement selected from all 31 poses. No Beauty change.
- `enemy_mesh_review_source.py` extracts dense persisted source geometry.
  `enemy-mesh-raster.mjs` independently projects/rasterizes source and decoded mesh
  independently at 6 and 12 texels/world px. Require IoU ≥0.95 at both densities in
  all 2,511 pose/view combinations; a tiny 3-texel raster is too sensitive to fringe aliasing.
  Contact sheets compare the actual old source projection against the new export.
- Source QA reuse requires identical source, repair/checker code, Blender version,
  anatomy, scale and sample times. Every new proxy is still decoded and tested.
  Image reuse additionally requires byte-identical full source geometry in all
  31 poses. A changed approximation cannot authorize unverified image reuse.

## Images and review

`enemy_mesh_render.py` produces 1024px Beauty/Albedo/Normal masters and separate
emission. Source lighting stays in Beauty. Albedo bypasses audited enemy form
shading/AO and retains authored texture/stains. Normal RGB is linear world normal
`(X right, Y south, Z up)`, A is raw AO visibility; coverage is Albedo A. Separate
emission retains Rabid's eyes without baking them into albedo.

64/128 exports retain margin 2, spacing 4, eight columns and four rows. Data atlases
are byte-copied, never alpha-composited: normal alpha is AO. Final QA checks every
packed tile, master dimensions, hashes and normal vector lengths.

Beauty differences use premultiplied RGBA max-channel delta ≥8/255 at 128px.
Repair regions unite old/new affected-object bounds, padded by 0.2 Blender units
plus 2 filter pixels. Require zero outside alpha changes and at most
max(12, 1% of changed pixels) colour outliers across 31 poses. This does not claim
pixel identity of all render noise. Automated metrics do not replace visual review.

Small sheets/reviews: `build/enemy-mesh/`. Masters, EXRs, Blends, dense geometry and
archives: `D:/Fragdachse-render/enemy-mesh-*`. No recursive deletion or junction
cleanup. Completed revisions are not overwritten.

## Commands

```powershell
node scripts/asset-pipeline/enemy-mesh-selfcheck.mjs
& 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' -B scripts/asset-pipeline/enemy_mesh_corridor_selfcheck.py
node scripts/asset-pipeline/enemy-mesh-run.mjs --plan --revision enemy-mesh-new
node scripts/asset-pipeline/enemy-mesh-run.mjs --geometry --revision enemy-mesh-new
node scripts/asset-pipeline/enemy-mesh-run.mjs --render --revision enemy-mesh-new
# Run enemy_mesh_review_source.py in Blender with each staged --job path.
node scripts/asset-pipeline/enemy-mesh-review.mjs --revision enemy-mesh-new --phase all
# After inspecting the sheets, supply an actual review JSON:
node scripts/asset-pipeline/enemy-mesh-finalize.mjs --revision enemy-mesh-new --review build/enemy-mesh/visual-review.json
& 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' -B scripts/asset-pipeline/enemy_mesh_archive.py --revision enemy-mesh-new
```

Optional `--reuse-source <revision>` reuses only verified source QA; omit it for a
full independent reproduction. `enemy-mesh-reuse-renders.mjs` supports only proved
geometry-equivalent image reuse. The finalizer seals `enemy-mesh.json` and evidence;
the archive writer verifies every ZIP member by SHA-256. Neither tool imports.
Static sheets/sampling do not verify browser playback, GPU batching or the later
21e enemy-material integration. Those belong to the runtime rounds.
