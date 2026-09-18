# Lobby forest artwork

Generated with the integrated `image_gen` tool on 2026-09-12. Exact prompts, selected source
filenames and intermediate iterations are recorded in [prompts.json](prompts.json).
The user's concept and follow-up ivy/medallion references guided the material palette.
The eight PNGs in this directory are the untouched authoring originals copied from the tool's output.
The game loads only their optimized exports in `runtime/`.

| Asset | Use |
| --- | --- |
| `frame.png` | Open walnut card frame with transparent interior |
| `wood.png` | Repeating horizontal walnut grain for buttons |
| `button-frame.png` | Quiet walnut rim, composed from fixed corners and repeated edges for all ordinary wood buttons |
| `leaves.png` | Small ivy ornaments |
| `medallion.png` | Continuous bare walnut ring with no foliage, partially transparent around the live badger preview |
| `relief.png` | Monochrome rifle duel between two badgers, always behind the roster |
| `ready.png` | Dedicated open ivy/walnut frame for the green ready action |
| `world.png` | Standalone branch sign for training-ground entry and return |

## Exporting and replacing artwork

After generating/replacing one of the original PNGs, update its provenance in
[prompts.json](prompts.json), then run from the repository root:

```sh
npm run assets:lobby-forest
```

The small configuration in [export-lobby-forest.mjs](../../../../scripts/export-lobby-forest.mjs)
defines original dimensions, pixel crops and output dimensions for exactly these eight images.
If a replacement changes dimensions or composition, review its crop and resolution there;
dimension mismatches fail rather than silently using an old crop. The button frame's 128px
authored corner in `LobbyForestAssets.ts` must still match the replacement's timber rim.
Do not overwrite the originals with exports. No image-generation step or network access is
needed for exporting; the existing `sharp` dependency performs the conversion.

Each export compares full-color optimized PNG with lossless WebP and writes the smaller
encoding, the generated `src/ui/lobbyForestExports.json` manifest and
[the byte-size comparison](runtime/REPORT.md). Commit those outputs alongside source changes.
Both candidate encodings use identical resized pixels; no palette reduction or lossy encoding
is used. Runtime resizing uses Lanczos3 with alpha handling, without trimming fine leaf edges.
Only the four existing explicit crops are baked in. Full-image padding on frame, wood, leaves
and medallion remains part of their established placement and scale.

Resolution choices follow actual consumers in `LobbyLayout.ts` and `forestTextures.ts`:

- Frame: keep all 1062×1482 pixels; the 596×832 card already uses a larger 1192×1664 cache.
- Wood: 896×896 retains over two samples per design pixel at the unchanged 438.9px repeat.
- Button frame: 536×92 retains about four samples per design pixel at the 8px corners.
- Leaves: 128×128 for the 40×40 popup ornament, with over 3× reserve.
- Medallion: 320×320 for a 140×140 ornament and its 280×280 cache.
- Relief: 940×410 for 460×200.64 and its approximately 920×401 cache.
- Ready: 1065×144 for 484×65.47 within the 484×80 button, over 2× plus hover reserve.
- World: 640×181 for 280×79.07 within the 280×80 button, over 2× plus hover reserve.

`sourceWidth`/`sourceHeight` describe the original cropped coordinate system. Rendering uses
them for aspect ratios and edge repeats, mapping samples onto the actual export dimensions;
integer rounding therefore cannot change frame proportions. Both wood-pattern consumers
compensate for the new source resolution, preserving visible grain size and repeat length.

## Runtime composition

`LobbyForestAssets.ts` owns preload names; `forestTextures.ts` composes cached textures.
The final frame is authored for the narrower cards' aspect ratio and scaled uniformly as a whole.
It deliberately does not stretch populated edge strips: that distorted leaves in earlier
browser iterations. Cards sit closer to the outer screen edges while retaining roster width.
Wood grain repeats at a stable scale. Ordinary wood button frames use fixed corners and
uniformly scaled, cropped edge repeats; small icon buttons use the same frame without squeezing
the timber grain. Dedicated action frames and the duel stencil use pretrimmed exports
and preserve the artwork's proportions. Small cutouts retain their existing caches for readable edges.
The black stencil receives a muted ochre Phaser 4 FILL tint and low opacity; it is independent
of roster length and scrolling. Exporting never modifies the generated original PNGs.

No PNG includes text or an input surface. Decorations belong to the card/popup container,
while the existing world-camera backdrop blur remains separate. The `forest` skin is selected
explicitly by lobby callers. Shared controls default to their original appearance for match
HUDs and larger screens. Brown controls leave the ready action as the only green button;
progression, player, team and equipment accents retain their meaning. Player, invitation and
loadout rows share the calm untextured field material. Progression and system controls, the
preview and its held item inherit the player card's slide transform; the centre sign stays fixed.
The room-code copy action also uses wood. The training-ground sign's backing extends under
its asymmetrical upper and lower branches so the entire opening is filled. The two large
card title labels are absent; player name and preview precede the name/colour controls.
Card contents live below their large outer frames, so ivy can overlap controls. Popups remain
above the frames, while late roster entries and player controls retain their card's motion.

Validation covers alpha cutouts, shipped assets, texture reuse, undistorted proportions,
skin isolation and lobby behaviour. Cutouts can contain imperceptible 1/255 alpha residue;
opaque backgrounds and painted checkerboards were rejected during production.
