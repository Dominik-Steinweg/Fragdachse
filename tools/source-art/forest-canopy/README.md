# Canonical canopy contracts

`coverage.json` version 1 preserves the accepted coverage contract as an independent, versioned configuration. Reference names/hashes document provenance, not runtime inputs. `material.json` version 1 preserves the accepted balanced material parameters. Neither canonical derivation nor packing reads review/probe outputs.

Run `node tools/source-art/forest-v9-neutral/derive.mjs --verify` to compare all 64 channels against the accepted material maps. Without `--verify`, it rebuilds those maps from the 16 selected native PNGs. `scripts/export-forest-v9.mjs` packs them verbatim into the production atlases.
