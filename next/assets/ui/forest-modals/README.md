# Forest modal artwork

`frame-kit.png` is an original, unmodified PNG from the integrated image generator.
Its generation prompt and reference are recorded in `prompts.json`. The existing
lobby artwork was used as a visual reference and has not been overwritten.

The square kit contains four fixed corners and four straight rails around a real
alpha opening. `src/ui/ForestModal.ts` composes different window sizes from these
pieces at one uniform scale: the outer fifths supply the corners, and rail repeats
are cropped instead of stretched. The middle is never drawn. Composed textures
have twice their display resolution; large and compact windows share corner scale.

The first generated kit was selected after checking the image and the real menus
in the local browser preview. Subsequent iterations adjusted layout and materials:
increased inner margins, protected footer space, quiet glass sections, warm labels,
and a taller upgrade window. No pixel processing or manual repainting was applied.

Normal action buttons reuse the finished lobby's walnut face and proportion-safe
button frame. The glass and its world blur are rendered separately from the PNG.

## Local verification

Run `npm run dev:browser` and open `/ui-preview.html`. This independent development
entry renders the production overlay classes with seeded, in-memory fixtures.
Its own ephemeral Storage is installed before game modules load. It imports no
ArenaScene or network runtime and is not included in the production entry/build.
Controls cover both languages, full inventories, twelve-player results, statistics
overflow, locked upgrades, host/client options, replay and technical result states.

The production lobby is tested separately through its normal menu buttons.
