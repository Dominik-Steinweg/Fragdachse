# Lobby forest artwork

Generated with the integrated `image_gen` tool on 2026-09-12. Exact prompts, selected source
filenames and intermediate iterations are recorded in [prompts.json](prompts.json).
The user's concept and follow-up ivy/medallion references guided the material palette.
Final PNGs are copied from the tool's output without modifying their pixels.

| Asset | Use |
| --- | --- |
| `frame.png` | Open walnut card frame with transparent interior |
| `wood.png` | Repeating horizontal walnut grain for buttons |
| `leaves.png` | Small ivy ornaments |
| `medallion.png` | Open ring around the live, player-coloured badger preview |
| `relief.png` | Low-opacity woodland/badger relief in unused roster space |

`LobbyForestAssets.ts` owns preload names; `forestTextures.ts` composes cached textures.
The final frame is authored for the cards' 4:5 aspect ratio and scaled uniformly as a whole.
It deliberately does not stretch populated edge strips: that distorted leaves in earlier
browser iterations. Card width increased while preserving the roster's content width.
Wood grain repeats at a stable scale, with procedural button/popup corners retaining their
radii. Small cutouts are resampled into display-sized caches for readable edges.

No PNG includes text or an input surface. Decorations belong to the card/popup container,
while the existing world-camera backdrop blur remains separate. The `forest` skin is selected
explicitly by lobby callers. Shared controls default to their original appearance for match
HUDs and larger screens. Brown controls leave the ready action as the only green button;
progression, player, team and equipment accents retain their meaning.

Validation covers alpha cutouts, shipped assets, texture reuse, undistorted proportions,
skin isolation and lobby behaviour. Cutouts can contain imperceptible 1/255 alpha residue;
opaque backgrounds and painted checkerboards were rejected during production.
