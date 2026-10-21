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

Since 2026-10-21 the ground right at the plates is the procedural apron in
`src/arena/BaseGroundingField.ts`: a narrow band of compacted gravel fines from the same gravel
material as the base sites, with loose stones and a seam into the real grass blades. On top of it
the gravel fringes (`edge-a/b/c`), the fine aggregate (`scatter`), the stone nests
(`corner-a` / `corner-b`) and `pebble-a` keep their earlier composition, each piece turned and
shifted a little (`src/arena/BaseGroundingLayout.ts`). The soil stains `soil-a` / `soil-b` read
as unrealistic pale ovals; they stay here for reference but are `"active": false` in
`prompts.json` and no longer exported.
