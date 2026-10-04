# Pipeline audit, 2026-10-04

Baseline: `c47b37ef`, Blender **5.2.1 LTS**, build `9e2066aef7ef` (the supplied
`D:/Blender Foundation/Blender 5.2/blender.exe`). No public asset, runtime registry,
Beauty image, geometry, pivot or animation mapping is changed by this work.

## Result and evidence

- Published inventory: **15 current character/enemy entries**, **1,183 material
  frames** across all retained manifest revisions, **72 mesh records** including
  inherited held meshes, and **1,776 legacy shadow-mask samples**. All source,
  archive and publication hash checks pass. No invalid encoded normals or interior
  alpha holes were found. Edge differences are recorded per frame.
- Available floats: **333 EXRs** checked. R2 and 21e4: no findings. Old 21c:
  the five known Albedo defects at 9/12/17/22/27. The 14 historical enemy bundles
  no longer retain EXRs; their PNG masters and all published sizes were checked.
  PNGs cannot contain NaN, but cannot prove that an old pre-encoding EXR was finite.
- Newly confirmed defect: Zombie pose 2 has **605 opaque-black master pixels**
  (3 at 128px), over intact Beauty. Fresh rendering without persistence removes
  all of them. The adopted correction changes 950 pixels in the defect/filter
  region and one unrelated pixel by **1/255**; alpha changes: **0**. Normal/AO,
  Emission, Beauty, other frames and all meshes retain the original bytes/pixels.
- Six additional frame findings are single black Beauty pixels in the player's
  64px poses 8/12 across the three retained manifests. They are only reported;
  neither their presence nor the unchanged alpha proves a render defect.

The D:-only prepared bundle is **`D:/Fragdachse-render/enemy-material-pipeline-ready`**:
14 enemies, 434 master poses, 1,860 images, seed/version/source/output hashes,
copied executed staging tools and per-frame QA. `--verify` passes. The corrected
Zombie comes from `D:/Fragdachse-render/pipeline-zombie-repair-003/zombie-badger`;
its exact Python snapshot and render inputs are retained there. The original
published Zombie material remains unchanged, as enemy material import/activation
is explicitly outside this task.

Reports/logs: `D:/Fragdachse-render/pipeline-audit/` (`published-final.json`,
`floats.json`, `prepared-verification.log`, `zombie-albedo-before-after.png`,
`assets-final.log`, `check-final.log`). The before/after crop was inspected directly;
no browser/GPU playback review was performed.

## Measured work avoided

Verified reuse avoids **2,165 of 2,170** Beauty/material render jobs (99.77%); the
remaining five rerender the one defective pose. Staging with two bounded workers
takes about **25 seconds**, including source/archive hashing and pixel checks.
This measures reuse of already produced assets, not a fresh full Blender build.

An independent repeated Zombie render (`pipeline-zombie-repair-003` then `004`)
records **4 cache hits / 0 material renders**. Material pass time drops from about
3 seconds to **0.34 seconds**; all **9 encoded material outputs** are byte-identical.
Beauty is independently rendered and may contain normal Cycles sampling variation;
the prepared bundle always keeps the accepted original Beauty. Source/tool changes
invalidate the cache, and missing/corrupt entries render again. There is no cache
eviction command; large data and cached EXRs stay on D:.

## Recheck

```powershell
npm run assets:verify-published -- --sources D:/Fragdachse-render --out D:/Fragdachse-render/pipeline-audit/published-final.json
npm run assets:prepare-enemy-materials -- --verify D:/Fragdachse-render/enemy-material-pipeline-ready
& 'D:/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup --python-exit-code 1 --python scripts/asset-pipeline/audit_float_sources.py -- --repo D:/Fragdachse-render/wt/pipeline --sources D:/Fragdachse-render --out D:/Fragdachse-render/pipeline-audit/floats.json
& 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' -B scripts/asset-pipeline/render_integrity_selfcheck.py
npm run test:assets
npm run check
```

New regression tests protect black-island detection, normal/AO semantics,
nonfinite pixels, frame/pivot mismatches, isolated tile repair and bounded jobs.
The Python selfcheck covers raw float gates and cache input invalidation/tampering.
Existing V2 export tests verify repeat-export byte parity and immutable source gates.
