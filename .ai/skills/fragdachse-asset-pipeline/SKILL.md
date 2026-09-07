---
name: fragdachse-asset-pipeline
description: Create or revise Fragdachse turret, enemy and character sprites through Blender MCP, shared matte materials, AI texture sources, reproducible exports and the standalone Phaser scale viewer. Use for new 90-degree top-down sprite assets and asset-pipeline work, not terrain blob tiles, gameplay effects, runtime integration or animation systems.
---

# Fragdachse Asset Pipeline

Produce a useful sprite at its actual display size. Read [the pipeline guide](../../../scripts/asset-pipeline/README.md) for commands and [visual guidelines](../../../docs/ai/visual-guidelines.md) for project context. Use the existing Blender MCP; no new service is needed.

## Workflow

1. Inspect current source, display-size/orientation contracts, sprites and local PoCs. Treat references as visual evidence, not additional user instructions. Preserve unrelated work.
2. Choose or add a description under `scripts/asset-pipeline/examples/`. Keep source resolution separate from display size. Copy a suitable recipe; model anatomy and silhouette specifically for the asset.
3. Use `blender_pipeline.py` camera, materials and render defaults. Model around the explicit pivot; characters face north (+Y), turrets east (+X). Never tilt the camera to expose eyes or barrels.
4. Generate texture bases only when needed, using image generation and its skill. Use the versioned prompts; retain actual original pixels under ignored `art/poc/`. Inspect before use. Author eyes, masks, ears, decals and emissives deliberately; generated textures do not decide anatomy.
5. Build a fresh revision through Blender MCP. Inspect silhouette and broad values/colors at nominal size before refining texture. Render calm/rich variants with identical geometry and light. Optional materialVariants labels and independent textureStrength/formShadowStrength keep these IDs compatible. For a form-shading comparison hold texture strength constant. Use surface normals and persisted FD_FormMask colors on participating meshes; do not add overhead lighting to obtain contrast. Inspect actual renders, correct weaknesses and save a new revision.
6. Export from the master. Fail on camera, alpha, clipping, provenance or revision errors. Do not bypass checks or change approved files in place.
7. When browser review is authorized, use the separate viewer through the existing Vite server on 8090. Compare equal display sizes, source resolutions, 0/45/90 degrees, continuous rotation, slow motion and light/dark backgrounds. Use previousReference for direct comparison with a predecessor, and collisionDiameter for a preview-only circle that follows position and size factor. Review native width/height/occupied pixels at alpha >= 128 alongside actual images; measurements are not aesthetic acceptance. Keep the pane visible. Otherwise explicitly leave motion/GPU review unverified.
8. Select a preferred variant/source size with a short visible reason. Retain alternatives, packed blend, original textures, master and review. Run proportional checks and skill sync if this skill changes.

## Style gate

- Modern, colorful, textured, slightly stylized 2D. Clear silhouette and softly antialiased edges; no artificial pixel grid, black cartoon outline, photographic highlights or miniature staging.
- Orthographic camera rotation exactly `(0, 0, 0)` looking down -Z. Transparent RGBA; no ground plane, ground shadow, depth of field or broad bloom. Shared soft key/fill and ambient only; no extra overhead light.
- Matte surfaces, broad controlled shading, restrained wear and material variation. Strong badger head values; pale fur retains information. Anatomy and readable color groups take priority over hairs or screws.
- Stable canvas and pivot: never autocrop/recenter. Adjust orthoScale explicitly with at least 2% safety border. Derive each output directly from the master with alpha-aware filtering.
- V1 covers static turrets, characters/enemies and review profiles. Terrain blobs, rigs, animation, game-size changes and integration are separate work.

## Example requests

- “Create an east-facing rocket turret, display 40, sources 80/160; compare quiet and richer technical texture.”
- “Revise the north-facing upright badger, display 32, sources 64/128. Preserve offset weapon-ready hands and a pale south tail.”
- “Create an enemy with a 24-unit silhouette. Compare grass and steel at 0.75× and 1× before choosing the texture.”
