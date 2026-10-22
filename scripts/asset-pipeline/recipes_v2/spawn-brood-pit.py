"""Catalog recipe of the brood nest and organic creep stain of the Brutkadaver (GDD Spawnbauwerk V1).

The asset is not built by the draft runner: it is modelled in a live Blender over the Blender Lab MCP socket and
rendered per opening with a fixed sun (scripts/asset-pipeline/spawn-carcass/README.md), then packed with
`node scripts/asset-pipeline/export-spawn-structure.mjs blender --label <label>`.
"""


def build(c, spec):
    raise RuntimeError('spawn-brood-pit is built in a live Blender: see scripts/asset-pipeline/spawn-carcass/README.md')
