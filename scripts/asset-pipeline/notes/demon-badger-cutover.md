# Demon Badger – production db-v2-r2, heat emission and shadow mesh (ready, not imported)

Asset branch `demon-badger-asset` (worktree `C:/Fragdachse/.claude/worktrees/intelligent-williams-315399`).
Nothing below is imported anywhere yet; the cutover runs in the code worktree `C:/Fragdachse-worktrees/demon-badger`.

## Result
- Production `db-v2-r2`, standard, 128 px selected and archived (`source-bundle.zip`). Copy with review JSON under
  `D:/Fragdachse-render/demon-badger/runs/db-v2-r2/demon-badger` (bundle hash identical to the worktree run).
  `db-v2-r1` was selected and archived first and is superseded (never import it): its sub-pixel toes, claws and creases
  were part of the shadow proxy, which then failed the IoU gate (0.940 in claw poses 19–25 at low sun). r2 tags them
  `meshShadowDetail`; its Beauty equals r1 within one code value.
- 61 poses, 8 × 8 sheet (1056 × 1056 at 128, margin 2, spacing 4), targetSize 24, displayScale 2.4, orthoScale 7.152:
  rest 0 · move 1–12 (16 fps, loop) · claw 13–30 (24 fps, strike 8, impact 11) · idle 31–42 (12 fps, loop) ·
  burst 43–50 (24 fps, start/end rest, blast 3 = sheet frame 46) · spit 51–60 (24 fps, start/end rest, release 4 = sheet frame 55).
  Move and claw keep the previous gait and pounce, so frames 0–30 match the old layout.
- Eye anchors (version 1, main pair) and socket `mouth` (flame muzzle in front of the nose, follows head thrust) on all 61 frames.
- Blend verifier `tests/assets/verify_asset_pipeline_v2.py`: 10/10 passed incl. the independent CPU render of frame 46.
- Heat emission sheet (`sheet-emission.mjs --revision db-v2-r2 --channel heat --neutral`): staged in the run at
  `standard/emission-heat/sheet-128.png` + `record.json`; same layout as Beauty; RGB white, alpha = coverage of the
  heat regions (encoding `srgb-hue-alpha-intensity`, range 1). Materials: `Dormant heat seams`, `Throat heat seam`.
  Eye anchors checked transparent on all 61 masters (max alpha 0). The throat seam only shows with the open jaw (spit,
  slightly in burst); Beauty itself flares it violet at the spit release, independent of heat.
- Shadow mesh `enemy-mesh-db-v2-r2`: 2000 vertices / 3901 triangles, 61 poses, silhouette IoU min 0.957 (fine 0.958)
  over 4941 pose/view samples, four paw contacts (`<leg> broad articulated paw`). Sealed (status reviewed-not-imported),
  material passes beauty/albedo/normal/emission at 64/128 checked (albedo unlit, emission carries eyes, dormant seams and
  the spit throat flare), archive `r4-source-bundle.zip` (1046 members, verified). Worktree:
  `art/poc/pipeline-v2/enemy-mesh/enemy-mesh-db-v2-r2/demon-badger`; copy without intermediates (receipt re-verified):
  `D:/Fragdachse-render/demon-badger/enemy-mesh/enemy-mesh-db-v2-r2/demon-badger`.
  The selected-mesh exporter now also accepts `<leg> broad articulated paw` (enemy_parts_a paws).

## Cutover in `C:/Fragdachse-worktrees/demon-badger` (in this order, repo root as cwd)
1. Take the asset branch: `git merge demon-badger-asset`.
   Conflict candidates if touched in parallel: `scripts/asset-pipeline/motions_v2.py` (dispatch + rest keys),
   `draft-v2.mjs` (`motionModule`), `blender_pipeline_v2.py` (reload list), `tests/assets/AssetPipelineCatalog.test.ts`
   (motion allowlist), `scripts/asset-pipeline/README.md`. `turret-emission.mjs` became `sheet-emission.mjs`
   (`turret-emission.mjs` stays as a wrapper, so `docs/ai/rendering.md` and `src/config/turretVisuals.ts` stay valid).
2. Runtime sheet, idle and eye anchors (`--run-root` = the revision folder):
   `node scripts/asset-pipeline/import-runtime.mjs db-v2-r2 demon-badger --run-root D:/Fragdachse-render/demon-badger/runs/db-v2-r2`
3. Heat emission (no render; checks revision, variant, size, layout and the live beauty hash from step 2;
   `--run-root` = the runs root above the revisions):
   `node scripts/asset-pipeline/sheet-emission.mjs demon-badger --publish --channel heat --run-root D:/Fragdachse-render/demon-badger/runs`
   → `public/assets/sprites/pipeline-v2/demon-badger/emission-heat.png` and the entry `demon-badger` in
   `src/assets/manifests/enemy-emission.json`: `{ revision, sheet, sha256, beautySheetSha256, channel: "heat",
   hue: "neutral", variant, sourceSize, encoding, range, peak, layout, eyeCheck }` (an existing file is kept, the entry
   is replaced). `enemyEmissionSheetPath` reads `revision`, `sheet`, `beautySheetSha256`.
4. Shadow mesh (the importer reads the worktree's own `art/poc`; copy the sealed folder without intermediates):
   `robocopy D:\Fragdachse-render\demon-badger\enemy-mesh\enemy-mesh-db-v2-r2\demon-badger C:\Fragdachse-worktrees\demon-badger\art\poc\pipeline-v2\enemy-mesh\enemy-mesh-db-v2-r2\demon-badger /E /XD intermediate pass-cache /XF *.log`
   `node scripts/asset-pipeline/enemy-mesh-selected-mesh.mjs import demon-badger enemy-mesh-db-v2-r2`
   (checks registry revision db-v2-r2 + 61 frames from step 2, the archive receipt and all member hashes; replaces the
   `demon-badger` entry in `src/assets/manifests/enemy-mesh-families.json`).
5. Remove the old mesh files: `git rm -r public/assets/sprites/pipeline-v2/demon-badger/mesh/enemy-mesh-r4-010`
6. `npm run assets:runtime` (emission files stay PNG by name).
7. `npm run test:assets`, then the code lane's own checks.

## Notes
- Catalog `gameIds` stay `["demon-badger"]`; the textureKey/sheetTextureKey come from the existing enemy config, so the
  overlay key is `enemy_demon_badger_walking_emission` under the code lane's `${sheetTextureKey}_emission`.
- The emission mask is coverage only; tint and fade it with the heat ramp (dark red → bright red → void violet) and
  keep ADD above the lighting. Its alpha is antialiased at 128 px; the heat regions are ~1–1.5 world px wide.
- Re-staging after another production build: `node scripts/asset-pipeline/sheet-emission.mjs demon-badger --revision <rev> --channel heat --neutral --run-root <runs root>`.
- Authoring previews of the mask: `sheet-emission.mjs demon-badger --preview <assets:preview folder> --channel heat --neutral`.
