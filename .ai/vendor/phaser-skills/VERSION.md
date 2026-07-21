# Phaser skills provenance

- Upstream: https://github.com/phaserjs/phaser
- Source directory: `skills/`
- Phaser tag: `v4.2.1`
- Commit: `41be1e462bc600064e498cba370bfa8c5c055a22`
- Imported: 2026-07-21
- License: MIT; exact upstream text is copied as `LICENSE.md`.
- Contents: all 28 skill directories from that source directory, unchanged.

The application dependency is declared as `^4.2.1` in `package.json` and resolved exactly to `4.2.1` in `package-lock.json`.

## Upstream link integrity

The pinned upstream files contain four broken relative Markdown links: two malformed `references/REFERENCE..//SKILL.md` targets and two sibling-skill links from nested `references/` directories. They are intentionally not patched here because the vendor skills must remain byte-for-byte identical to upstream. Recheck this exception on the next pinned update.

## Update procedure

1. Verify the exact installed Phaser version in both package files.
2. Select a fixed official Phaser tag/commit compatible with that version; never import a moving branch.
3. Replace every vendor skill directory with the complete upstream `skills/` directory and refresh `LICENSE.md` unchanged.
4. Update this file, run `npm run ai:sync`, then compare canonical sources with `.agents/skills/` and `.claude/skills/` and validate every `SKILL.md`.
