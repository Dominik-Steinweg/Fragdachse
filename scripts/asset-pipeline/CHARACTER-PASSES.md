# Character passes v1 — rounds 21a/21b/21c

Additive pass tooling; production is explicit (`--production`), runtime import is a separate
21d command (`--apply`). Neither command modifies the original beauty selection/archive.
The existing V2 beauty builder, exporter, source blend, catalogue and validators are unchanged.
`player-shadow-v1.json` is the executable pass specification; `character-passes.d.ts` is a
runtime-facing **draft**. The main README's fixed beauty lighting / no-floor rule still
applies to beauty. The separately requested shadow receiver is scoped to these new passes.

## Coordinates and sampling

- X right, Y south, Z up; Blender XYZ converts with `(1,-1,1)`. The source faces north.
- Ground `z=0`, world pivot `(0,0,0)`, body UV pivot `(0.5,0.5)`.
- Body canvas is 38.4 world pixels across 2.2 Blender units: 17.454545 world px/unit.
- Azimuth points **toward the light**, clockwise from asset +X. North is 270 degrees.
  Transform the screen-space light by inverse displayed sprite rotation; shadow points away.
- 16 azimuths at 22.5-degree intervals; elevations 28, 35, 45 degrees. Interpolate cyclic
  azimuth and `cot(elevation)`, clamp outside the supported elevation interval. No implied
  night sun; contact and artificial-light policy remain a later runtime concern.
- Pilot poses are exported indices 0, 1, 4, 7, 25. Index 25 is maximal idle breathing
  (Blender timeline frame 51); these are **not** interchangeable with timeline indices.

## Canvas and coverage

`projected_canvases` evaluates all 37 source poses, not just the pilot subset. For every
light sample it unions `xy - (z-ground) * light.xy/light.z`, adds a conservative finite-sun
penumbra margin and two world pixels, then snaps bounds outward to the texel grid.
Each resulting rectangular canvas stays fixed across poses. The camera remains exactly
orthographic top-down; moving it to the declared rectangle implements a fixed authored
transform, never per-frame autocropping. Blender projection is verified against its four
logical rectangle limits before rendering.

`boundsWorld`, `pivotPx`, and six-number `pixelToWorld` are mandatory. Image rows go south;
pixel coordinates address edges, so texture sampling uses `pixel + 0.5`. Pivot can be
outside a cropped rectangle. No clamping to normalized `[0,1]` is permitted.

Shadow sources use two texels per world pixel, rendered at 4x supersampling, 64 Cycles
samples, deterministic seed 37, no denoising, and a 2-degree solar disk (pilot art parameter).
The copied figure is invisible to camera rays and visible to shadow rays. A white diffuse
plane and black opaque caster overrides prevent coat colours, AO or bounce light from
entering the mask. Each light has an unoccluded reference render. Coverage is the clamped
linear ratio `1 - shaded/reference`, then area-filtered to unorm8. Near-zero reference,
empty masks and coverage reaching the outer two texels fail verification.

## Material data

- **Albedo:** emission-only, light-independent, straight sRGB8 RGBA; A is body coverage.
  sRGB encoding deliberately preserves dark fur precision. It is colour, not a linear data
  texture. Runtime must decode it before linear lighting; publication may use lossless WebP.
- **Normal:** linear RGB = `0.5*n+0.5`, A = scalar ambient accessibility (1 unoccluded).
  Alpha is **not coverage**. No premultiplication, gamma conversion or colour publication.
- AO uses evaluated full geometry at distance 0.65 Blender units, 32 AO samples.
- The archived material adapter bypasses the named Form shadow strength, Painted contact
  depth and Cool sides/warm crown contributions, preserves authored coat/mask/eye colours,
  and rejects residual lighting dependencies reachable from albedo. It never modifies the
  archived blend or global recipe materials. Future recipes should expose explicit albedo
  outputs rather than silently expanding this historical adapter.
- Float EXR intermediates retain coverage. Downsampling weights linear albedo, normal and
  AO by coverage; normals are decoded, averaged and renormalized. Normal/AO gets two texels
  of data dilation outside coverage. Invalid empty normals use `(0,0,1)`.
- Source sizes 64 and 128 derive directly from the 1024 master. Beauty masters are reused
  from the hash-bound original source; beauty is not rerendered or colour-adjusted.

## Publication draft

`render-passes.json` binds all images, pose indices, rectangles, source blend/render/
selection/spec hashes and tool hashes. `atlas-passes.json` binds that manifest by SHA-256.
Every page declares pass, encoding, dimensions, download bytes, RGBA8 GPU bytes and hash.
All pages are shared by instances; mipmaps are disabled. Max page dimension is 2048.

Shadow packing groups **four poses for the same light** into RGBA, so all channels share
the identical canvas and resolution. Remaining channels in the last group are zero.
Each sample names pose, canvas, page, channel and rectangle. All four channels are data,
including A. Material pages retain RGBA separately, with explicit pose/source-size entries.
Two-texel gutters are excluded from sample rectangles. No source-over composition is used
while packing. A decoded byte-for-byte atlas verification checks every sample afterwards.

Later runtime integration must register data passes explicitly with the existing publication/
hash URL layer; do not infer data semantics from file size or reuse colour alpha handling.
This pilot does not write `src/`, `public/`, `tests/`, or the runtime manifests.

## Commands and output boundaries

Read-only source/hash preflight (does not start Blender or create output):

```powershell
node scripts/asset-pipeline/player-shadow-pilot.mjs --plan --revision player-shadow-21b-pilot
```

After `D:/Fragdachse-render` is writable by the executing session:

```powershell
node scripts/asset-pipeline/player-shadow-pilot.mjs --revision player-shadow-21b-pilot
```

Default Blender is `D:/Blender Foundation/Blender 5.2/blender.exe`, headless and hidden,
OPTIX. `--device CPU|CUDA|OPTIX` is explicit; missing requested devices fail. The driver
creates a new exclusive directory under `D:/Fragdachse-render`, copies the original blend,
snapshots tooling, redirects TEMP/TMP, and retains EXR intermediates and `blender.log` there.
It never saves a modified blend, overwrites a run, or falls back to C: for render output.
All new rendering/packing/review/archive output stays on D:. The historical 21b reviews
remain in `build/player-shadow/pilot/`; new runs use `<revision>/review/page-01/` etc.
Each page contains at most eight poses, including all three PNG review types and metrics.

Independent read-only verification after export:

```powershell
node scripts/asset-pipeline/export-character-passes.mjs D:/Fragdachse-render/player-shadow-21b-pilot --verify
```

Review outputs: `shadow-contact-35deg.png` (5 poses × 16 azimuths),
`game-size-beauty-shadow.png` (5 poses × 4 light states × 3 rotations at 1 pixel/world px),
`beauty-albedo-normal-ao.png`. The ground is a neutralized existing forest-floor texture.
Beauty deliberately keeps its old fixed lighting in the requested shadow comparison.
Mask contact thumbnails are fitted individually; only the gameplay sheet preserves scale.
The normal preview substitutes coverage alpha for display only; original AO data stays intact.

Render timings report per-shadow min/median/mean/max and `mean * 1776` for the full character.
Reference and material costs are reported separately; this is not a runtime performance claim.
Inspect the actual images before judging side anatomy. Static review cannot validate animation
interpolation or GPU performance. Claude approved the original 21b pilot for 21c.

## Production and source archive (21c)

```powershell
node scripts/asset-pipeline/player-shadow-pilot.mjs --production --plan --revision player-shadow-21c-production
node scripts/asset-pipeline/player-shadow-pilot.mjs --production --revision player-shadow-21c-production
```

The first command only checks inputs. The second renders all 37 exported poses, including
the idle pose, move and breathing frames in their original timeline mapping: 1,776 shadow,
111 material and 48 receiver jobs. `--production` rejects `--poses`; an incomplete
production manifest fails validation. The renderer and exporter carry separate
`production-unreviewed` status: this records coverage of the full source, not a fabricated
human review of the new output. Pilot manifests remain backward compatible.

The command verifies the original beauty archive before copying its packed blend and
complete original source bundle. It snapshots tools, effective/authored specs, source
selection/render metadata, selected beauty masters and the review floor. Every new EXR,
pass PNG, packed page, review and log is retained. `selection.json` (version 2, separate
`fd-character-pass-selection` schema) hashes all inputs/outputs. `source-bundle.zip`
contains those files, selection and `archive-manifest.json`; it is streamed and read back
with SHA-256 checks before exclusive publication. `archive-receipt.json` binds ZIP and
selection hashes and reports archive size/seal time. No existing revision is overwritten
or resumed. Failed runs remain diagnostic artifacts; restart with a new revision name.

`completion.json` records Blender wall time and total wall time before archiving;
`archive-receipt.json` adds sealing time, while the final console line includes subsequent
bundle verification too. The sealed archive contains all regeneration inputs; original
absolute paths in job metadata describe provenance. When relocating a reproduction,
adapt the job paths in a NEW working revision, never edit the sealed selection.

## Material audit and optional control

The pilot's 16 unique source materials have emission strength zero. The adapter preserves
base colour/texture, bypasses authored form/contact/temperature lighting, and deliberately
removes specular reflection from albedo. It does not brighten the coat to imitate the
beauty light. Emission above zero or linked emission strength now fails explicitly until
a separate emission contract exists. Material copies are deduplicated; this does not
change pixels. AO is raw ambient visibility (1=open), not the beauty's artistically
contrasted contact ramp. Apply AO to ambient light in 21d, not a second baked albedo.

The unchanged pilot pixels therefore need no exposure or AO-contrast correction.
An optional two-pose control checks the updated runner/adapter before full production:

```powershell
node scripts/asset-pipeline/player-shadow-pilot.mjs --poses 0,4 --revision player-shadow-21c-control
```

Inspect `D:/Fragdachse-render/player-shadow-21c-control/review/page-01/`.
It uses the same archive/export/verification path; estimate about 1–3 minutes including
archiving. It is optional, not a substitute for the all-frame production review.

## Prepared publication (21d, not executed in Spur B)

```powershell
# Read-only verification/preview after production exists:
node scripts/asset-pipeline/import-character-passes.mjs D:/Fragdachse-render/player-shadow-21c-production
# Later, in Spur A / 21d:
node scripts/asset-pipeline/import-character-passes.mjs D:/Fragdachse-render/player-shadow-21c-production --apply
```

Import requires a sealed, fully verified 37-pose revision and verifies archive readback
using the current trusted verifier. It copies PNG bytes without conversion to
`public/assets/sprites/pipeline-v2/badger/passes/<revision>/` and writes identical manifests
there and to `src/assets/manifests/character-badger-<revision>.json`. Destinations must be
new; it does not replace any active registry/manifest. Pages retain layouts, channels,
encodings, source hashes and byte totals. Filenames contain full content hashes; page URLs
also use the existing `?v=<sha256>` convention. `shadow-mask` and `normal` filenames keep
data out of A2 colour publication. Albedo may later use A2 lossless colour publication;
runtime resolves logical `page.file` via `runtimeAssetUrl`, with the explicit `page.url`
available before publication. Data must always use linear, non-PMA uploads. Source albedo
is straight sRGB; a future PMA colour-loader path must account for its coverage explicitly.
The supplied upload contract uses non-PMA for both passes to keep their shader contract
unambiguous. Import does not run A2, change the URL registry or activate gameplay rendering;
Spur A owns that integration and its checks.

## Checks

The repository keeps pipeline tests under `tests/assets`, not inside the pipeline. The new
test proposal is therefore delivered as `build/player-shadow/21ab-tests.patch`. It protects
coordinate conventions, cyclic/cotangent interpolation, schema completeness, source binding,
non-PMA channel preservation, page bounds and continued acceptance of the original beauty.
Do not run the repository pretest/build hooks in this parallel work stream.
