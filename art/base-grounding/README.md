# Foundation gravel

Six original sprites generated with the built-in ImageGen tool. The selected full-resolution
RGBA sources are in `source/`; final prompts and asset mapping are in `prompts.json`.
The screenshot supplied by the user and `public/assets/sprites/base47blob.png` served as
palette and top-down style references. Buildings remain on their original tileset.

Rejected drafts contained baked checkerboards or architectural shapes. A targeted
background-removal edit did not resolve the checkerboard, so that fringe was regenerated.
Corner groups were regenerated as natural stones without the architectural references.
Only the selected transparent outputs are retained here.

Run `node scripts/export-base-grounding.mjs` from the repository to export runtime PNGs.
The export crops to visible alpha (8/255), ignoring almost invisible distant generator
specks that would otherwise shrink the stones. Within that crop it preserves generated
alpha, resamples with aspect ratio preserved, and adds a four-pixel transparent gutter.
Fringe canvases follow the cropped aspect ratio; compact clusters use square canvases.
It does not create replacement procedural art.

Horizontal fringes: `edge-a` (earthy), `edge-b` (slate chips), `edge-c` (flat fragments).
Small corner accents: `corner-a` and `corner-b`. Secondary soil: `scatter`.
Runtime placement is authored in `src/arena/BaseGroundingLayout.ts` and follows exposed
cell edges. Soft neutral lighting permits quarter-turn rotations below the existing shadows.
