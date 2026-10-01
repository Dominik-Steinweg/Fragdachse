# Woodland transmission source

Generated with the built-in ImageGen tool on 2026-09-29. Export with `node scripts/generate-scene-sunlight.mjs`.


This is an authored projection of a forest ceiling, not a physical reconstruction of visible tree geometry. The sunlight visibility field samples this transmission. Existing tree and rock shadows retain their own geometry.

## Prompt

Use case: stylized-concept. Asset type: grayscale seamless forest sunlight transmission mask (gobo) for a 2D top-down game renderer, NOT a finished scene. Generate a square full-frame seamless single-channel grayscale texture. It represents sun transmitted through an irregular leafy forest ceiling: soft dark branching masses and clusters of overlapping broad leaves block light, white and light-gray irregular openings transmit it. Use 5-8 very broad, unequal open patches, separated by branching mid-gray foliage masses; irregular small leaf-shaped gaps only subordinated to these broad openings. Natural woodland canopy pattern, dappled sunlight with hierarchy and restrained detail. Roughly 45 percent average gray brightness, luminous openings occupy about one third of area. Penumbra edges are softly feathered, not blurry overall. Flat orthographic projection, no perspective, no horizon. Smooth scalar transmission values only, no physical surfaces, no tree trunks, no rocks, no grass, no texture grain, no speckles, no tiny dots, no cast shadows within the mask, no embossed or volumetric shading, no sunlight rays, no gradients from one side of image to other. Tileable at every edge without borders. Black=blocked, white=open. Neutral grayscale RGB with opaque background, no text, labels, watermarks or panels.
