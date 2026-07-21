---
name: visual-production
description: Produce or revise polished Fragdachse gameplay visuals in Phaser 4, including explosions, impacts, particles, projectiles, trails, muzzle flashes, enemy death, status and area effects, shaders, filters, PostFX, camera feedback, sprites, PNGs, weapons, pickups, enemies, props, buildings, environment objects, and decals. Use for any task that creates or materially changes visible gameplay art or effects; do not use for purely non-visual gameplay, network, data, or configuration work.
---

# Visual Production

Follow this workflow for every triggered visual task:

1. Read `docs/ai/visual-guidelines.md` and inspect `docs/ai/reference-implementations.md` for the closest established pattern.
2. Inspect at least one relevant implementation and, for asset work, at least one comparable file under `public/assets/`. Verify call-sites, scale, depth, update ownership and teardown.
3. Load only the relevant official Phaser skills from the agent's project skill directory. Typical choices are `particles`, `tweens`, `filters-and-postfx`, `cameras`, `sprites-and-images`, `graphics-and-shapes`, `render-textures`, `animations`, and `loading-assets`.
4. Decide the effect's gameplay purpose and timing before coding: anticipation/flash, readable primary form, main impact, optional secondary layers, residual and cleanup. Use only layers that support that purpose.
5. Reuse existing renderers, texture helpers, pools, depth constants, color utilities, muzzle/offset helpers and lifecycle hooks. Keep authoritative gameplay state out of visual code.
6. Produce a production-ready result unless the user explicitly requests a prototype. Do not stop at a primitive placeholder effect.
7. Do not generate or introduce a new asset unless the request explicitly asks for asset creation or the user first approves it. Reusing an existing asset does not require approval.
8. For every generated or edited gameplay asset, validate direct orthographic 90° top-down perspective, transparent background where required, scale, orientation and in-game readability. Reject isometric, three-quarter, oblique, horizon-bearing, perspective-tapered or side-revealing assets.
9. Verify complete cleanup for emitters, timers, tweens, filters, masks, temporary textures and Game Objects. Prefer bounded counts, reuse and pooling for frequent effects.
10. Run the proportional repository checks from `AGENTS.md`; for visible behavior, build and perform one focused browser check at the end.

When requirements conflict with an existing reference, preserve gameplay readability and the verified project contracts, then document the deliberate deviation in the handoff.
