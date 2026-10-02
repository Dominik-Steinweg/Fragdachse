# Character material repair / R2 handoff

21e4 uses the immutable 21c source Blend (SHA-256 `7bb22c9a13389ddf1381b145d82d73ed88e37ee5a913aad2834e7853641e1be1`). Beauty, mesh, camera, pivot and pose mapping are unchanged. Only material samples 9/12/17/22/27 are replaced. The separate material-only manifest has four pages; the old D-mask manifest is not republished or loaded for materials.

## Verified failure and fix

The original exporter enables `scene.render.use_persistent_data` and interleaves Albedo/Normal/AO assignments for each pose. Opaque zero RGB already exists in the original EXR Albedo, before atlas packing, gamma conversion or the runtime shader. Original affected objects: eye (9), tail (12), pupil (17), ear (22), eyelid (27). Beauty has no corresponding missing surface. 17/27 are small master-level defects which mostly disappear at runtime resolution.

A 37-pose control with the original persistent pass schedule reproduced 227 opaque black Albedo pixels in pose 31. The same interleaved schedule with persistence disabled produced none. A separate pass-major run without persistence also produced none over all 111 float images. This establishes the failing pass/cache lifetime; the precise internal Cycles invalidation defect is not diagnosed. Do not repair pixels, change the rig, or hide the error in the runtime shader.

`scripts/repair-character-materials.py` disables persistent data, assigns each material pass once, flushes dependencies, samples the original poses, and uses the existing exporter reduction and encoding. It rejects nonfinite or opaque-black outputs. The original source Blend is never overwritten. Each new label is exclusive; completed revisions cannot be overwritten.

## Reproduce

Use Blender 5.2 and an unused output label. Set `OPTIX_CACHE_PATH` to a writable cache directory (the restricted Windows user cache caused repeated 80-160 second AO compiles). For example, in PowerShell:

```powershell
$env:OPTIX_CACHE_PATH = 'D:\Fragdachse-render\player-material-21e4\optix-cache'
& 'D:\Blender Foundation\Blender 5.2\blender.exe' -b 'D:\Fragdachse-render\player-shadow-21c-production\source.blend' --python-exit-code 1 --python scripts/repair-character-materials.py -- --all --label verification-new
```

Without `--all`, the five defective poses are rendered. `--control` reproduces the old interleaved persistent schedule; `--control --no-persistent` changes only persistence. Neither control can be imported. Runtime import is `node scripts/import-character-material-repair.mjs <isolated-render-folder>`; the named runtime revision must not already exist. The importer copies untouched frames exactly and replaces repaired frames plus their two-pixel gutters, with no filtering. Page and source-frame hashes enter the material manifest. All 37 poses must still be audited after importing.

For R2, build a new full source bundle with its new rig and mapping first. Reuse the pass-major/no-persistence policy and the zero/normal/coverage/Beauty checks; do not reuse this repair's hash-locked source or old geometry. Keep authored dark pupil pixels distinct from accidental all-zero material output.

## Verification evidence

- Original 128px near-black pixels over nonblack Beauty: 9=16, 12=44, 22=114; after import all 37 poses at both sizes: zero.
- Encoded normal lengths 0.993783-1.006331, as expected for RGB8 quantization; no opaque alpha holes. Existing maximum alpha-edge difference to Beauty remains 30/255 (mean per pose at most 0.7454/255).
- Material regression: 15,307,584 texel/rotation/sun combinations, finite positive factors; noon RGB mean ratios 0.98845-1.04506 relative to Beauty. No material tuning changes.
- Live `build/player-shadow/mat4-zoom.png`: Map 1, seed 12345, 17:00, right-facing, zoom 4, displayed frames pinned only in the browser probe to 9/12/22. Columns Beauty / material / albedo. Actual frame status is in `build/21e4-live-status.json` (`players[].pose`; the last material draw's top-level pose is naturally stale while Beauty is enabled).
- Own visual assessment: ear hole, eye and tail defects removed. Material remains slightly flatter on arms than Beauty; no optional retuning was added. Browser page errors: none. Own browser closed.

`build/21e4-material-tests.log`, `build/21e4-assets-after.log`, `build/21e4-build.log` contain verification logs. Tests/docs are supplied in `build/21e4-tests-docs.patch` because direct writes to those paths were denied in this session; they were tested through a read overlay against the actual source/assets.

Repair source archive: `D:/Fragdachse-render/player-material-21e4/source-bundle-21e4.zip` (60,443,381 bytes), SHA-256 `ab5d6bda02e7a81294ade72b781c0a08cad22a555dc0ff9f575888085a18d972`. Contains original packed Blend, exact executed render script/helper, corrected masters/exports, control receipts and audits; `archive-receipt.json` enumerates file hashes. This is an additive child of the unchanged 21c production, not an edited original archive.

Cleanup of `build/21e2-work` and the abandoned `control-r2/intermediate` was attempted with explicit absolute paths, but automatic command policy rejected recursive deletion. They remain; no workaround was attempted.
