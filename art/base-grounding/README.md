# Foundation gravel

Grounding sprites generated with the built-in ImageGen tool. The selected full-resolution
RGBA sources are in `source/`; final prompts, active selection and asset mapping are in `prompts.json`.
The screenshot supplied by the user and `public/assets/sprites/base47blob.png` served as
palette and top-down style references. Buildings remain on their original tileset.

Rejected drafts contained baked checkerboards or architectural shapes. A targeted
background-removal edit did not resolve the checkerboard, so that fringe was regenerated.
Corner groups were regenerated as natural stones without the architectural references.
Only selected transparent outputs are retained here. Soil was regenerated with broad alpha
falloff after editing attempts produced baked checkerboards; those rejected drafts are excluded.

Run `node scripts/export-base-grounding.mjs` from the repository to export runtime PNGs.
The export crops to visible alpha (8/255), ignoring almost invisible distant generator
specks that would otherwise shrink the stones. Within that crop it preserves generated
alpha, resamples with aspect ratio preserved, and adds a four-pixel transparent gutter.
Soil canvases follow the cropped aspect ratio; compact clusters use square canvases.
It does not create replacement procedural art.

The active palette uses `soil-a` and `soil-b` as softly fading earth beneath separated
`corner-a` / `corner-b` stone nests. `pebble-a` supplies the medium and small outer stones.
The three gravel fringes (`edge-a/b/c`) and `scatter` complement those nests as separate,
irregular deposits. Sparse smaller deposits appear between nests; no texture is laid along
every exposed edge. All nine generated assets are active. The soil uses a warmer, darker
multiply tint and stronger opacity to remain legible on the actual pale gravel terrain.
Its generated alpha still feathers the transition; fine aggregate sits above it, below stones.
Runtime placement in `src/arena/BaseGroundingLayout.ts` follows exposed cell edges, favors
corners, and spaces nests apart. Neutral lighting permits rotation below the existing shadows.
