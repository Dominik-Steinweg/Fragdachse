# Projected character mesh — pilot and production

Authoring contract with a prepared, opt-in runtime importer. The unchanged Beauty
pipeline and 21a material passes remain independent. The export runner writes no
runtime files and can run independently of the parallel runtime integration.

New geometry manifests include `provenance` with the Blender build, Python/NumPy,
source/tool hashes and an explicit deterministic-geometry/no-random-seed policy.
Publication preserves that metadata. `npm run assets:verify-published -- --sources
D:/Fragdachse-render` checks the published player/enemy buffers, finite shared
bounds, fixed topology, index ranges and pose mapping against source manifests and
archives. It complements the existing silhouette/corridor suites; it does not
replace their geometric acceptance criteria. See [PIPELINE-AUDIT.md](PIPELINE-AUDIT.md).

## Commands

```powershell
node scripts/asset-pipeline/mesh-shadow-selfcheck.mjs
node scripts/asset-pipeline/player-mesh-run.mjs --revision player-mesh-22b-pilot --plan
node scripts/asset-pipeline/player-mesh-run.mjs --revision player-mesh-22b-pilot
```

The last command is for Claude. Blender is launched hidden/headless at
`D:/Blender Foundation/Blender 5.2/blender.exe`. No Cycles renders are performed:
it evaluates source geometry and writes buffers. All source copies, logs, geometry,
software-rendered images and the immutable source archive go to
`D:/Fragdachse-render/player-mesh-22b-pilot/`. The runner mirrors only final review
images/metadata to `build/player-shadow/mesh-pilot/player-mesh-22b-pilot/`.
Existing output directories fail; select a fresh revision instead of overwriting.
`--plan` hashes/preflights inputs without creating output or starting Blender.

Defaults bind the selected `v2-ai/badger` and `v2-aj/held-glock` source bundles.
`--weapon-source art/poc/pipeline-v2/runs/<revision>/<held-id>` selects another
archived `held-weapon` or `held-utility` recipe in pilot mode. Production resolves
every held entry from the catalog and current Beauty registry, as described below.
`--body-source` and `--d-source` must describe the same selected body source.
Sources, selected beauty masters and D references are hashed and copied before export.
Original blends are never saved or modified. Python's temporary files stay on D:.

If only the local review mirror failed (e.g. its directory already existed), preserve
the completed D: revision. `--review-only` regenerates review into the **absent** local
revision directory without changing D:. Normal reruns never resume an incomplete run.

## Coordinates, pose and encoding

- X right, Y south, Z up; Blender conversion `(x,-y,z)`. Body origin and ground z=0.
- Body canvas 38.4 world pixels / 2.2 Blender units = 17.454545 world px/BE.
- Rotation is clockwise in XY. Light points toward the sun. Project after instance
  and socket transforms: `q.xy = p.xy - light.xy * max(0,p.z)/light.z`.
  The offline review rejects light at/below the horizon; future runtime must fade
  direct shadow and guard the denominator there.
- All **37** poses are baked and topology checked. Review selects 0/1/4/7/25.
  `poses` binds beauty index, Blender timeline frame, clip, clip-local frame and beauty
  hash. Frame 0 is rest, not the looping idle clip. No duplicate loop closure.
- One fixed triangle index buffer and vertex order per mesh. Positions are LE uint16
  XYZ, pose-major then vertex-major. Decode `min + q/65535*(max-min)` using one bound
  over all poses, including flat axes. Indices are LE uint16 triples, no restart index.
- `downloadBytes` counts uncompressed binary payload only (no HTTP compression,
  JSON, review or source archives); `gpuFloat32Bytes` assumes decode to Float32 XYZ
  plus shared U16 indices. Positions can alternatively remain quantized on GPU.
- Hash-named binary files and SHA-256 entries bind content, topology and sources.
  [mesh-shadows.d.ts](mesh-shadows.d.ts) is the runtime-facing **draft**, not a loader.

## Fixed proxy and sockets

The exporter evaluates each source part in the rest pose, collapses triangles once,
and binds each remaining proxy vertex barycentrically to the nearest original source
triangle. At every frame the original skinning/modifiers are evaluated; these fixed
bindings transfer the deformation. Source polygon connectivity and vertex count must
remain identical in all 37 poses. Proxy topology is never recalculated per pose.
`proxy-bindings.json` and the manifest audit record bindings, source objects,
excluded subpixel details, simplification attempts and rest snap distances.

Before rest decimation and BVH binding, degenerate/ill-conditioned triangles and
duplicate faces are removed. The quality threshold is relative to each triangle's
longest edge, so tiny valid bevels remain bindable. Source vertex identities are
never welded. Barycentric weights use normalized cross products in float64, with
nearest-edge handling outside the triangle; this avoids the former absolute
`1e-20` Gram-determinant cutoff. Per-part cleanup counts are recorded for body and
weapon. Library startup scenes are ignored: `FD_MESH_SCENE` logs the explicitly
selected asset scene, verified asset ID, active context and visible mesh count.

The body must have 1,000–2,000 vertices and 2,000–4,000 triangles; failure to meet the
budget aborts. This gate does **not** prove silhouette fidelity. See D comparisons.
Existing pilot weapon proxies retain their 600-vertex / 1,100-triangle contract.
New static union proxies use a size-dependent budget (see production r2 below)
and still have exactly one pose.

Hands are explicit source objects with `motionRole=grip`. On each side, the largest
grip part is the paw (the smaller thumb is not the socket). Its evaluated origin and
proper rotation define left/right sockets. The pilot's weapon socket equals the right
palm, including its rotation. Matrix layout is row-major; Blender rotations convert
with `C R C`, not a single reflection. XYZ comes from geometry transforms, not a
guessed constant height. This is an explicit pilot mount requiring visual acceptance.
It does not reuse the old runtime `(0,-10.8,16)` placement or assert two-hand alignment.

Weapons reuse the existing authored grip/muzzle empty controls from the selected
held recipe, checked against `heldItem` reference coordinates. Geometry is grip-local,
including Z, scaled to its 38.4-world-pixel beauty canvas (3.2 BE for Glock), **not**
scaled by the body's 2.2-BE canvas. Runtime applies the same socket, instance scale,
rotation and recoil to mesh and weapon image. `beautyGripUv` preserves image placement.

## Review and acceptance

- `rotation-p{0,1,4,7,25}-z{1,3}.png/.apng`: fixed pose, sun azimuth 45° / elevation
  35°, body 0..90° in 5° steps. APNG uses full SOURCE replacement, no frame blending;
  ping-pong avoids an artificial 90→0° loop jump. Each image is freshly projected.
- `elevations-z{1,3}.png`: five poses at 20/28/35/45/60°, same fixed world canvas.
- `reference-p*.png`: body-only at eight baked 45° azimuth steps, elevation 35°;
  D / mesh / difference / beauty. Difference: red D-only, cyan mesh-only, white
  overlap. IoU at 50% coverage is recorded, not used as an aesthetic acceptance gate.
- `weapon-anchors-z3.png`: yellow top-view grip, cyan the same point projected onto
  ground. Inspect actual palm/weapon silhouette contact, not just coincident markers.

Offline masks use 3 samples/world pixel, opaque triangle union, small separable blur
(sigma .45 world px), then downsampling for zoom 1. Zoom 3 uses native sample density.
Beauty and weapon source images share the exact transforms and pivots. The floor is
the neutralized existing forest texture. The shader's future height-dependent solar
penumbra and runtime GL costs are deliberately not claimed by this offline pilot.

Claude should reject lost legs/tail, arm collapse, weapon drift, clipped long shadows,
5° stepping that remains objectionable at game size, or large pose-specific differences.
The animation is sampled at 5°, not a claim of continuous-time runtime rendering.
Only visual approval authorizes the later runtime round.

## Verification and costs

`mesh-shadow-selfcheck.mjs` checks projection signs, below-ground clamp, grip attachment
through rotations, winding/overlap-independent union, blur, quantization, indices,
manifest budgets/pose mapping and APNG SOURCE/sequence semantics. The proposed asset
test is supplied separately as a patch under `build/player-shadow/mesh-pilot/`.
The selected source archives are verified before Blender; output buffers, mappings
and all source hashes are checked before reviews and immutable ZIP sealing.

Pure Python binding regressions, without starting Blender:

```powershell
& 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' -B scripts/asset-pipeline/mesh_shadow_geometry_selfcheck.py
```

The Python check uses the bundled NumPy, not bpy. It covers tiny valid faces,
degenerate/duplicate faces, source identity preservation, stable deformation weights,
edge/vertex closest points, library scene selection and the actual exporter's binding
function with an isolated BVH service. The runner archives both helper and checks.

Estimated body payload: 234–468 KB for 37 poses and indices; Float32 GPU: 456–912 KB.
Legacy weapon: bounded by 10.2 KB binary / 13.8 KB Float32 GPU. Production r2 has a
28.8 KB binary / 38.4 KB Float32 GPU absolute per-weapon cap. JSON/source archives are additional. Geometry export plus all PNGs
and APNGs is provisionally a few minutes, dependent on source mesh density; this is
not measured. `completion.json` records actual times and byte totals.

## Repaired production (Claude)

```powershell
node scripts/asset-pipeline/player-mesh-run.mjs --production --revision player-mesh-22-production-r3 --plan
node scripts/asset-pipeline/player-mesh-run.mjs --production --revision player-mesh-22-production-r3
```

`--production` exports all 37 body poses, sockets, and all 28 currently registered
held weapons/utilities (18 weapons, 10 utilities). `mesh-shadow-sources.mjs` resolves
selected authoring folders by BOTH imported idle/sheet hashes, never by newest run.
The catalog, registry, individual selections, Blend files and source archives become
hashed revision inputs. Unknown, missing, ambiguous or mismatched assets fail closed.
`--weapon-source` only affects pilot mode. Body and weapon coordinate/budget contracts
above keep their axes, grip/muzzle and encoding. Each weapon records game IDs,
source role and its explicit size-dependent proxy budget.

After Blender geometry evaluation, `mesh-shadow-repair.mjs` adds two closed, moving
hip connectors. Rest-selected vertex weights follow the baked upper leg and pelvis;
no per-frame decimation, nearest-surface rebinding, Beauty edit or 2D hole filling.
Each connector has four 12-sided rings and two cap centers (50 vertices/96 triangles).
Its radius is at most 2.35 world px; endpoint disks shrink to 90% of the minimum
source-plane clearance and stay strictly inside the original convex parts. The
pelvis anchor blends 70% side region / 30% pelvis center. Anatomical attachment
weights, positions and all 74 endpoint checks are archived in `shadowRepair`.
These rules are badger-specific, not an automatic adapter for arbitrary enemies.

The unfilled `mesh-base-manifest.json` and its binaries remain authoring evidence.
The final `mesh-manifest.json` has `status: production-unreviewed`; runtime bytes
include only the repaired body and weapon binaries. All are quantized with shared
pose bounds, hashed and read back before review. The review repeats the gap metric
on the DECODED uint16 output, not on the unquantized construction.

`mesh-shadow-gap-metric.mjs` measures 37 × 16 × 3 = 1,776 cases at 28/35/45°:
shortest projected leg-to-pelvis/torso boundary segment, 2-world-pixel-wide capsule,
missing coverage below 50%, at least 0.5 world px² to flag. Raster density is 2 and
Gaussian sigma 0.45 world px. The anatomical corridor is frozen BEFORE filling;
global body connectivity and intentional arm openings do not decide acceptance.
The baseline is the unfilled MESH (different coverage than the old D-mask analysis).
Any remaining flagged case prevents completion/archive/import. No implicit waivers.
An additional 4-texel/world-pixel top-down test forbids footprint enlargement beyond
0.125 world px² (two quantization-sensitive samples); current pilot measurement is 0.

Production review is mirrored to
`build/player-shadow/mesh-prod/<revision>/`:

- `gap-metric.json`, `gap-by-pose.csv/.png`: all samples and per-pose before/after.
- `worst-gap-before-after.png`: the largest gap for each critical pose; white
  overlap/cyan added shadow in the difference column.
- `rotation-p{4,5,10,11}-before-after-z{1,3}.apng`: a full 360° loop in 5° steps,
  70 ms/frame, left BEFORE/right AFTER. PNG contact sheets are split into four
  quadrants per pose/zoom. The arm opening and separation of distal legs must survive.
- `weapons-in-hand-{1..4}.png`: every exported weapon on the P4 palm at 0/45/90°,
  sun azimuth 45°/elevation 35°. Yellow marks the top-view grip, cyan its projection.

The runner verifies all selected sources, writes completion/selection, seals a ZIP
with a verified archive manifest, and records selection/archive hashes in the receipt.
Missing output directories are required; failed revisions are never overwritten.
`completion.json` reports binary Download/GPU-Float32 bytes and geometry/review time;
JSON and source archive sizes are separate. Visual approval remains a human review.

Offline regression against the accepted pilot, WITHOUT Blender or D: writes:

```powershell
node scripts/asset-pipeline/mesh-shadow-production-selfcheck.mjs
node scripts/asset-pipeline/mesh-shadow-production-selfcheck.mjs --review
```

The latter writes an explicitly marked preflight under `build/player-shadow/mesh-prod/`:
real existing body/Glock geometry, not a claim that the 28-weapon production ran.
It also checks 20/60° as a diagnostic beyond the mandatory production grid.

Prepared import for Spur A / 22c (do not execute during authoring):

```powershell
node scripts/asset-pipeline/import-character-mesh.mjs D:/Fragdachse-render/player-mesh-22-production-r3
node scripts/asset-pipeline/import-character-mesh.mjs D:/Fragdachse-render/player-mesh-22-production-r3 --apply
```

Default is read-only verification. `--apply` publishes byte-preserving, full-SHA256
binary filenames and hash URLs into
`public/assets/sprites/pipeline-v2/badger/mesh/<revision>/`, plus
`src/assets/manifests/character-mesh-badger-<revision>.json`. It verifies selected
members, archive readback, topology/budgets, gap/footprint gates, all held mappings
and compatibility with the CURRENT Beauty registry first. Existing destinations
are rejected. Registration, loading and renderer activation remain separate 22c work.

## Production r2: shared static weapon volume

Historical first union policy; r3 extends its candidate search and batch handling
below. Its silhouette thresholds remain unchanged.

P90 exposed a structural floor in independent part decimation: 47 source objects,
703 vertices remaining even after the target dropped to 119 triangles. Decorative
bevel/material seams and separate cartridges must not each reserve minimum topology.
The animated body continues to use fixed per-part skinning bindings; only STATIC
held-weapon/held-utility exports use the following method:

1. Evaluate the exact selected frame. Gather every nondegenerate visible source
   surface, without the former small-diagonal exclusion. Preserve this complete
   source as the software silhouette reference.
2. Copy the evaluated world-space geometry into a temporary mesh, weld coincident
   seams at 1e-4 of the voxel size, recalculate face normals, and apply a Voxel Remesh
   volume union. Interior ornament surfaces disappear into the shared solid. There
   is no global convex hull that would fill intentional grip openings. Disconnected
   component removal is disabled; a meaningful separate barrel/tip cannot be dropped
   merely because its component is small. Originals and saved Blends remain intact.
3. Decimate the welded UNION once per candidate, with no minimum per decorative
   part and no barycentric rebinding to the pre-union source. Try voxel sizes
   0.20/0.12/0.075 world px and shared triangle targets 55/80/100% of the budget.
   Refine or increase the target when the silhouette gate fails; stop on the first
   candidate satisfying both budget and silhouette gates. All attempts are audited.
4. `held-size-v2`: `sizeWorld` is the largest source bounding-box extent in world px.
   Maximum vertices = `clamp(ceil((300 + 24*sizeWorld)/100)*100, 600, 1600)`;
   maximum triangles = twice that value. The declared budget travels in the manifest;
   validators recompute it. Legacy immutable pilots without this field keep their
   old caps. Counts and download/GPU totals remain measured from actual binaries.
5. Compare the **quantized** candidate against the full source at 16 azimutes ×
   28/35/45° plus top view (49 views). Pure NumPy triangle-union rasterizer, 3 texels
   per world px, no lighting/materials/body occlusion. Each view must have IoU >=95%
   AND no missing/added silhouette outside a two-texel square neighborhood. The
   second criterion catches thin lost barrels that a total-area IoU can hide.
   These are sampled-view gates, not a mathematical guarantee for every angle.

The exporter writes hashed `weapon-quality/<id>.json/.png` evidence. Final bundle
validation/import verifies all 49 directions, policy thresholds, report/image hashes
and budget consistency. A failed candidate is never silently accepted or omitted;
if all candidates fail, the revision stops with attempts and the last comparison
in the weapon-quality folder. This may require an explicit authoring adjustment.

The existing all-weapon in-hand contact sheets remain. New
`weapon-source-proxy-<id>.png` sheets show source/proxy differences independently of
the body: grey overlap, red source-only, cyan proxy-only, labelled angle/elevation
and IoU. `weapon-union-summary.json` lists actual counts, budgets and attempts.
Review evidence stays in the source archive and is not imported as runtime payload.

No-Blender regression checks for this path:

```powershell
& 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' -B scripts/asset-pipeline/mesh_shadow_weapon_selfcheck.py
node scripts/asset-pipeline/mesh-shadow-selfcheck.mjs
```

These cover hidden ornament equivalence, lost thin barrels, preservation of grip
openings, size scaling, winding/overlap, quantization, QA validation and the actual
Blender adapter's settings/lifetime via a mocked service. They do not execute Blender
or establish the actual remesh quality of the 28 selected assets. Additional source
and candidate silhouette checks make r2 slower than the previous export; measure the
full run with `completion.json` rather than reusing the old wall-time estimate.

## Production r3: thin-part reserve and complete weapon batch

The final r2 crossbow candidate at 0.075 world px already reached minimum IoU
0.95627, but missed one pixel beyond the existing edge tolerance in each of two
45° views. Its size policy capped it at 800 vertices; only 778 were used. This is
not evidence that the bowstring is shadow-irrelevant, so no gate exception is made.

`held-adaptive-v3` retains the size formula as `baseVertices` (600–1,600) and grants
each weapon a hard quality reserve of 1,600 vertices / 3,200 triangles. Candidates
first use the former three voxel stages and base budget. On failure, the 0.075-world-
pixel union is reused at 70/90/100% of the reserve triangle budget. Further stages
at 0.05 and 0.035 world px use the same reserve. The first passing candidate wins;
successful coarse weapons do not incur the full refinement cost. The unmodified
49-view IoU/edge gate is evaluated on quantized output for every candidate. There
is still a finite cost ceiling: an asset that fails every candidate is reported
as failed, never silently accepted. Absolute binary/GPU size caps remain as in r2.

`evaluate_weapon_batch` catches individual export exceptions, records each result
in `weapon-batch/<id>.json`, opens the next selected source and evaluates the entire
held list. `weapon-batch-report.json` records all expected IDs, counts, failures,
timings and per-weapon evidence. Only an entirely passing batch produces the mesh
manifest and proceeds to completion/archive/import. Validators require complete,
passing batch evidence for v3 meshes. A keyboard interruption/native process crash
cannot be treated as a finished batch; available checkpoints are marked partial.

On a failed Blender exit, the Node runner copies the aggregate report, available
QA JSON/PNGs and log into the exclusive local review directory before reporting the
failure. Success also includes the aggregate report in its normal review and source
archive. The source revision is never resumed/overwritten. This avoids repeated
one-weapon-at-a-time failures without publishing an incomplete production.

No-Blender source and prior-evidence preflight:

```powershell
node scripts/asset-pipeline/player-mesh-weapon-preflight.mjs --previous D:/Fragdachse-render/player-mesh-22-production-r2
node scripts/asset-pipeline/mesh-shadow-batch-selfcheck.mjs
```

The preflight verifies all current selected Blend/render hashes, registry anchors
and source archives, then checks available previous QA reports and image hashes.
It writes JSON/CSV under `build/player-shadow/mesh-prod/r3-preflight-<timestamp>/`.
An unsealed previous run is labelled as prior evidence, never as a new r3 result.
Weapons lacking evaluated geometry remain explicitly not evaluated. This does not
claim a geometry gate pass from a recipe or PNG alone; Claude's batch obtains the
remaining real results. The batch selfcheck tests continuation, failed-publication
rejection, complete/partial reports and diagnostic mirroring without Blender.
