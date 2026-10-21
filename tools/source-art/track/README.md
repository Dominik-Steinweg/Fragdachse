# Railway bed sources

- `sleeper-wood.png`: seamless weathered wood (grain along x), source of
  `public/assets/sprites/sleeper_wood_material.png` (Lanczos to 256 px). Prompt, model and seed are in
  `sleeper-wood.prompt.txt`.
- The rails (`public/assets/sprites/track_rails.png`) are procedural: `node scripts/generate-track-rails.mjs`.

Sleepers, tie plates, ballast and the verge are drawn per pixel at runtime
(`src/arena/TrackGravelField.ts`, `src/arena/DirtSurfaceField.ts`).
