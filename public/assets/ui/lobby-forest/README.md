# Lobby forest artwork

Generated with the integrated `image_gen` tool on 2026-09-12. Exact prompts, selected source
filenames and intermediate iterations are recorded in [prompts.json](prompts.json).
The user's concept and follow-up ivy/medallion references guided the material palette.
Final PNGs are copied from the tool's output without modifying their pixels.

| Asset | Use |
| --- | --- |
| `frame.png` | Open walnut card frame with transparent interior |
| `wood.png` | Repeating horizontal walnut grain for buttons |
| `button-frame.png` | Quiet walnut rim, composed from fixed corners and repeated edges for all ordinary wood buttons |
| `leaves.png` | Small ivy ornaments |
| `medallion.png` | Delicate open twig with two leaves, partially transparent around the live badger preview |
| `relief.png` | Monochrome rifle duel between two badgers, always behind the roster |
| `ready.png` | Dedicated open ivy/walnut frame for the green ready action |
| `world.png` | Standalone branch sign for training-ground entry and return |

`LobbyForestAssets.ts` owns preload names; `forestTextures.ts` composes cached textures.
The final frame is authored for the narrower cards' aspect ratio and scaled uniformly as a whole.
It deliberately does not stretch populated edge strips: that distorted leaves in earlier
browser iterations. Cards sit closer to the outer screen edges while retaining roster width.
Wood grain repeats at a stable scale. Ordinary wood button frames use fixed corners and
uniformly scaled, cropped edge repeats; small icon buttons use the same frame without squeezing
the timber grain. Dedicated action frames and the duel stencil trim transparent source margins at runtime
and preserve the artwork's proportions. Small cutouts use display-sized caches for readable edges.
The black stencil receives a muted ochre Phaser 4 FILL tint and low opacity; it is independent
of roster length and scrolling. No preprocessing changes the generated PNG pixels.

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

Validation covers alpha cutouts, shipped assets, texture reuse, undistorted proportions,
skin isolation and lobby behaviour. Cutouts can contain imperceptible 1/255 alpha residue;
opaque backgrounds and painted checkerboards were rejected during production.
