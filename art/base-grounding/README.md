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

Since 2026-10-21 the ground around a base is the procedural apron in
`src/arena/BaseGroundingField.ts` (trodden soil, gravel drifts, a seam into the real grass blades).
Only the stone nests remain sprites: `corner-a` / `corner-b` with one or two `pebble-a`, sparse and
corner-biased (`src/arena/BaseGroundingLayout.ts`). The soil, gravel-fringe and scatter sources stay
here for reference but are `"active": false` in `prompts.json` and no longer exported.
