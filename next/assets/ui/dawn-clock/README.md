# Dawn clock / semicircular asset kit

Concept C, following docs/GDDs/Fragdachse_From_Dachs_Till_Dawn_Uhr_V1.md and the Dawn Druck art direction.
Generated materials and glyphs: built-in Imagegen, prompts in sources/PROMPTS.json. Exact masks, registration, export and proof: Sharp.

## Rebuild

Run `node scripts/export-dawn-clock.mjs` from the repository (also works from other working directories).
Uses existing Sharp; no install, runtime code, browser, or package.json change. Sources are immutable.
The second run writes no changed bytes. No timestamps/randomness in outputs. Same Sharp/libvips versions are needed for byte-identical encoding.

## Files and geometry

- 12 parts, 24 lossless WebPs: runtime/<part>-1x.webp (300 x 160) and -2x.webp (600 x 320).
- Canonical manifest: [runtime/manifest.json](runtime/manifest.json). All geometry is in 1x design pixels; multiply ALL coordinates/radii by two for 2x pixels.
- Every layer uses the full canvas. Common pivot (150, 140), normalized origin (0.5, 0.875); do not trim layers independently.
- Upper semicircular scale: inner radius 86, outer radius 119. Frame: 121-136, bottom rail y=138..154.
- Screen coordinates x right/y down: arc angle = 180 + 180 * progress. Left/start=180, top=270, right/finish=360.
- Hand points up: rotation = -90 + 180 * progress degrees. Bone tip length 106; dark outline reaches 109; rear length 6. Tip glyph center (150,37), radius 103.
- Medallion radius 20 at pivot; dark icon slot diameter 32. Modifier icon 24-32, clipped to radius 16, drawn ABOVE the medallion plug. The proof uses 30.
- Arc symbols fit 24 x 24; pointer symbols 19 x 19 including dark backing (glyph 15 x 15). Wave notch 7 x 14.5; forked finale 13 x 18.5. Sizes include contrast edging.

## Composition

Follow manifest.layerOrder. Sectors are NOT baked into face/frame; derive boundaries from the actual schedule and resolved wave plan.
Arc-grain is black grayscale ink with encoded alpha, only within R86-119; normal over blending at opacity 1. No color tint needed.
Hand and notches rotate about the common pivot. Symbols are stored at canonical center (150,37): translate to their target arc points and keep upright; the proof adds a dark round backing for contrast on pale sectors.
Tip symbols rotate with the hand. The hand's charcoal edge preserves visibility across both light and dark backgrounds.
Medallion covers the hand root. The neutral brass plug remains when there is no modifier.
Recommended assembled display 150 x 80; lower bound 120 x 64. At 150 px width all design values halve (modifier 15 px in this proof).
Wave pulse and phase-glint are runtime behavior, not baked into these assets.

## Proof and provenance

- [Contact sheet](../../../../art/poc/dawn/ui/clock/kit/clock-kit-board.png): all 12 parts; three mounted states; each at 150 x 80 / 120 x 64 over both day/night crops (12 combinations).
- 2x PNG parts and mounted previews are under art/poc/dawn/ui/clock/kit/.
- Example fractions 37/8/50/5 percent, waves at progress .47/.585/.70 and finale .81. These are proof data, NOT runtime defaults.
- Night modifier comes from public/assets/ui/dawn/runtime/night-blood-moon-64.webp.
- Gameplay crops: original G1 board__lichtung-day.png / board__lichtung-night.png from sibling dawn/build/dawn/G1, native crop x330/y290/360x210, copied into kit/sources for repeatability. Older 2026-10-13 captures serve only as backdrops.
- Source hashes and output hashes in manifest. Export validates common dimensions, alpha corners, frame opening, semicircular face/arc bounds, and grayscale grain.
- Static asset/proof inspection only; no live gameplay or animation verification.

Knowledge writeback: No durable project knowledge discovered.
