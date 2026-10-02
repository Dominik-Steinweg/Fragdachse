// R0 diagnostic data. No renderer imports this module. See docs/depth-layering.md.
import type { LayerContract } from './EffectLayerContract';
import type { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxLaneId } from './gpu/GpuVfxRenderLanes';
export const GPU_LAYER_CONTRACTS = {
  "AirstrikeSpark": {
    "id": "lane:AirstrikeSpark",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "AirstrikeSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect"
  },
  "AirstrikeBomb": {
    "id": "lane:AirstrikeBomb",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "AirstrikeBomb",
    "height": "high",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect"
  },
  "RocketExhaust": {
    "id": "lane:RocketExhaust",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "RocketExhaust",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      15.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "RocketSmoke": {
    "id": "lane:RocketSmoke",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "RocketSmoke",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "StinkNormal": {
    "id": "lane:StinkNormal",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "StinkNormal",
    "height": "body",
    "lighting": "mixed",
    "camera": "world",
    "depths": [
      17.02
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "StinkAdd": {
    "id": "lane:StinkAdd",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "StinkAdd",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.04
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "FlameOuter": {
    "id": "lane:FlameOuter",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "FlameOuter",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      16
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "FlameCore": {
    "id": "lane:FlameCore",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "FlameCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      16.05
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "FlameSpark": {
    "id": "lane:FlameSpark",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "FlameSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      16.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "GroundFire": {
    "id": "lane:GroundFire",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "GroundFire",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect"
  },
  "GroundFireSmoke": {
    "id": "lane:GroundFireSmoke",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "GroundFireSmoke",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      9.12
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect"
  },
  "EntityBurn": {
    "id": "lane:EntityBurn",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "EntityBurn",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.23
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect"
  },
  "ProjectileBurn": {
    "id": "lane:ProjectileBurn",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ProjectileBurn",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      15.34
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "WorldDebris": {
    "id": "lane:WorldDebris",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "WorldDebris",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "ExplosionSpark": {
    "id": "lane:ExplosionSpark",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionEmberDown": {
    "id": "lane:ExplosionEmberDown",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionEmberDown",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionEmberUp": {
    "id": "lane:ExplosionEmberUp",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionEmberUp",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionAccent": {
    "id": "lane:ExplosionAccent",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionAccent",
    "height": "body",
    "lighting": "mixed",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionCascade": {
    "id": "lane:ExplosionCascade",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionCascade",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.12
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionTrainChunk": {
    "id": "lane:ExplosionTrainChunk",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionTrainChunk",
    "height": "body",
    "lighting": "mixed",
    "camera": "world",
    "depths": [
      25.24
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionTrainSpark": {
    "id": "lane:ExplosionTrainSpark",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionTrainSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionHolyCrown": {
    "id": "lane:ExplosionHolyCrown",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionHolyCrown",
    "height": "high",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.32
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionTrainCore": {
    "id": "lane:ExplosionTrainCore",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionTrainCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.34
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionNukePlume": {
    "id": "lane:ExplosionNukePlume",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionNukePlume",
    "height": "high",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.4
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionNukeFallout": {
    "id": "lane:ExplosionNukeFallout",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionNukeFallout",
    "height": "high",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25.35
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionRegeneration": {
    "id": "lane:ExplosionRegeneration",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionRegeneration",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.35
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "ExplosionSmoke": {
    "id": "lane:ExplosionSmoke",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ExplosionSmoke",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.96
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "GoreNormal": {
    "id": "lane:GoreNormal",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "GoreNormal",
    "height": "body",
    "lighting": "mixed",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "GoreAdd": {
    "id": "lane:GoreAdd",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "GoreAdd",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.05
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect"
  },
  "PowerUpPedestal": {
    "id": "lane:PowerUpPedestal",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "PowerUpPedestal",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      7.95
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect"
  },
  "MuzzleFlash": {
    "id": "lane:MuzzleFlash",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "MuzzleFlash",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "FlightSignature": {
    "id": "lane:FlightSignature",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "FlightSignature",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      13.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect"
  },
  "MovementGround": {
    "id": "lane:MovementGround",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "MovementGround",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect"
  },
  "ElectricGround": {
    "id": "lane:ElectricGround",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ElectricGround",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      5.45
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect"
  },
  "ElectricBody": {
    "id": "lane:ElectricBody",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "ElectricBody",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect"
  },
  "WaterSurface": {
    "id": "lane:WaterSurface",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "WaterSurface",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      5.25
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect"
  },
  "TrainGround": {
    "id": "lane:TrainGround",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "TrainGround",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.35
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect"
  },
  "TrainBody": {
    "id": "lane:TrainBody",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "TrainBody",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      11.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect"
  },
  "TrainSmoke": {
    "id": "lane:TrainSmoke",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "TrainSmoke",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      18.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect"
  },
  "TrainHeat": {
    "id": "lane:TrainHeat",
    "owner": "effects/gpu/GpuVfxRenderLanes.ts",
    "component": "TrainHeat",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      19.7
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "E"
    ],
    "role": "effect"
  }
} as const satisfies Record<keyof typeof GpuVfxLaneId, LayerContract>;
export const GPU_EFFECT_CONTRACTS = {
  "AirstrikeBomb": {
    "id": "gpu:AirstrikeBomb",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "AirstrikeBomb",
    "height": "high",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "AirstrikeBomb"
    ]
  },
  "AirstrikeSpark": {
    "id": "gpu:AirstrikeSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "AirstrikeSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "AirstrikeSpark"
    ]
  },
  "RocketExhaust": {
    "id": "gpu:RocketExhaust",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "RocketExhaust",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      15.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "RocketExhaust"
    ]
  },
  "RocketSmoke": {
    "id": "gpu:RocketSmoke",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "RocketSmoke",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "RocketSmoke"
    ]
  },
  "StinkInner": {
    "id": "gpu:StinkInner",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "StinkInner",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.02,
      17.04
    ],
    "blends": [
      "ADD",
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "StinkNormal",
      "StinkAdd"
    ]
  },
  "StinkPlume": {
    "id": "gpu:StinkPlume",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "StinkPlume",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.02,
      17.04
    ],
    "blends": [
      "ADD",
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "StinkNormal",
      "StinkAdd"
    ]
  },
  "StinkAccent": {
    "id": "gpu:StinkAccent",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "StinkAccent",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.04
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "StinkAdd"
    ]
  },
  "StinkEdge": {
    "id": "gpu:StinkEdge",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "StinkEdge",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.04
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "StinkAdd"
    ]
  },
  "FlameCore": {
    "id": "gpu:FlameCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlameCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      16.05
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "FlameCore"
    ]
  },
  "FlameOuter": {
    "id": "gpu:FlameOuter",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlameOuter",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      16
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "FlameOuter"
    ]
  },
  "FlameSpark": {
    "id": "gpu:FlameSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlameSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      16.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "FlameSpark"
    ]
  },
  "GroundFireOuter": {
    "id": "gpu:GroundFireOuter",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "GroundFireOuter",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "GroundFire"
    ]
  },
  "GroundFireCore": {
    "id": "gpu:GroundFireCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "GroundFireCore",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "GroundFire"
    ]
  },
  "GroundFireSpark": {
    "id": "gpu:GroundFireSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "GroundFireSpark",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "GroundFire"
    ]
  },
  "GroundFireSmoke": {
    "id": "gpu:GroundFireSmoke",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "GroundFireSmoke",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      9.12
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "GroundFireSmoke"
    ]
  },
  "ProjectileBurnOuter": {
    "id": "gpu:ProjectileBurnOuter",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ProjectileBurnOuter",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      15.34
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "ProjectileBurn"
    ]
  },
  "ProjectileBurnCore": {
    "id": "gpu:ProjectileBurnCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ProjectileBurnCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      15.34
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "ProjectileBurn"
    ]
  },
  "ProjectileBurnSpark": {
    "id": "gpu:ProjectileBurnSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ProjectileBurnSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      15.34
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "ProjectileBurn"
    ]
  },
  "EntityBurnCore": {
    "id": "gpu:EntityBurnCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "EntityBurnCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.23
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "EntityBurn"
    ]
  },
  "EntityBurnOuter": {
    "id": "gpu:EntityBurnOuter",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "EntityBurnOuter",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.23
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "EntityBurn"
    ]
  },
  "EntityBurnSpark": {
    "id": "gpu:EntityBurnSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "EntityBurnSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.23
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "EntityBurn"
    ]
  },
  "LeafDebris": {
    "id": "gpu:LeafDebris",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "LeafDebris",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "WorldDebris"
    ]
  },
  "LeafBlowerDust": {
    "id": "gpu:LeafBlowerDust",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "LeafBlowerDust",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "WorldDebris"
    ]
  },
  "GroundFireHeatBody": {
    "id": "gpu:GroundFireHeatBody",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "GroundFireHeatBody",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "GroundFire"
    ]
  },
  "ExplosionSpark": {
    "id": "gpu:ExplosionSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionSpark"
    ]
  },
  "ExplosionEmberDown": {
    "id": "gpu:ExplosionEmberDown",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionEmberDown",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionEmberDown"
    ]
  },
  "ExplosionEmberUp": {
    "id": "gpu:ExplosionEmberUp",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionEmberUp",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionEmberUp"
    ]
  },
  "ExplosionAccent": {
    "id": "gpu:ExplosionAccent",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionAccent",
    "height": "body",
    "lighting": "mixed",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionAccent"
    ]
  },
  "ExplosionCascade": {
    "id": "gpu:ExplosionCascade",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionCascade",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.12
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionCascade"
    ]
  },
  "ExplosionTrainChunk": {
    "id": "gpu:ExplosionTrainChunk",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionTrainChunk",
    "height": "body",
    "lighting": "mixed",
    "camera": "world",
    "depths": [
      25.24
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionTrainChunk"
    ]
  },
  "ExplosionTrainSpark": {
    "id": "gpu:ExplosionTrainSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionTrainSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionTrainSpark"
    ]
  },
  "ExplosionLightningSpark": {
    "id": "gpu:ExplosionLightningSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionLightningSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionTrainSpark"
    ]
  },
  "ExplosionHolyCrown": {
    "id": "gpu:ExplosionHolyCrown",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionHolyCrown",
    "height": "high",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.32
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionHolyCrown"
    ]
  },
  "ExplosionTrainCore": {
    "id": "gpu:ExplosionTrainCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionTrainCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.34
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionTrainCore"
    ]
  },
  "ExplosionNukePlume": {
    "id": "gpu:ExplosionNukePlume",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionNukePlume",
    "height": "high",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.4
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionNukePlume"
    ]
  },
  "ExplosionNukeFallout": {
    "id": "gpu:ExplosionNukeFallout",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionNukeFallout",
    "height": "high",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25.35
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionNukeFallout"
    ]
  },
  "ExplosionRegeneration": {
    "id": "gpu:ExplosionRegeneration",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionRegeneration",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.35
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionRegeneration"
    ]
  },
  "GroundFireEmber": {
    "id": "gpu:GroundFireEmber",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "GroundFireEmber",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      9.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "GroundFire"
    ]
  },
  "ExplosionBody": {
    "id": "gpu:ExplosionBody",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionBody",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionEmberDown"
    ]
  },
  "ExplosionSmoke": {
    "id": "gpu:ExplosionSmoke",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionSmoke",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.96
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionSmoke"
    ]
  },
  "ExplosionShockwave": {
    "id": "gpu:ExplosionShockwave",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionShockwave",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionAccent"
    ]
  },
  "ExplosionSecondary": {
    "id": "gpu:ExplosionSecondary",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ExplosionSecondary",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      25
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionEmberDown"
    ]
  },
  "DeathFragment": {
    "id": "gpu:DeathFragment",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "DeathFragment",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "DeathMicroFragment": {
    "id": "gpu:DeathMicroFragment",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "DeathMicroFragment",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "DeathGlow": {
    "id": "gpu:DeathGlow",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "DeathGlow",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.05
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreAdd"
    ]
  },
  "BloodCore": {
    "id": "gpu:BloodCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BloodCore",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "BloodStreak": {
    "id": "gpu:BloodStreak",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BloodStreak",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "BloodDroplet": {
    "id": "gpu:BloodDroplet",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BloodDroplet",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "BloodMicroDroplet": {
    "id": "gpu:BloodMicroDroplet",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BloodMicroDroplet",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "PowerUpPedestalAmbient": {
    "id": "gpu:PowerUpPedestalAmbient",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "PowerUpPedestalAmbient",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      7.95
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "PowerUpPedestal"
    ]
  },
  "PowerUpPedestalSpark": {
    "id": "gpu:PowerUpPedestalSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "PowerUpPedestalSpark",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      7.95
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "PowerUpPedestal"
    ]
  },
  "PowerUpPedestalBurst": {
    "id": "gpu:PowerUpPedestalBurst",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "PowerUpPedestalBurst",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      7.95
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "PowerUpPedestal"
    ]
  },
  "MuzzleFlashBody": {
    "id": "gpu:MuzzleFlashBody",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MuzzleFlashBody",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "MuzzleFlash"
    ]
  },
  "MuzzleFlashSpark": {
    "id": "gpu:MuzzleFlashSpark",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MuzzleFlashSpark",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      17.001
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "MuzzleFlash"
    ]
  },
  "DeathFragmentGlow": {
    "id": "gpu:DeathFragmentGlow",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "DeathFragmentGlow",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.05
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreAdd"
    ]
  },
  "FlightCore": {
    "id": "gpu:FlightCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlightCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      13.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "FlightSignature"
    ]
  },
  "FlightWake": {
    "id": "gpu:FlightWake",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlightWake",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      13.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "FlightSignature"
    ]
  },
  "FlightMote": {
    "id": "gpu:FlightMote",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlightMote",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      13.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "FlightSignature"
    ]
  },
  "FlightPressure": {
    "id": "gpu:FlightPressure",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "FlightPressure",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      13.2
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "FlightSignature"
    ]
  },
  "MovementFootprint": {
    "id": "gpu:MovementFootprint",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MovementFootprint",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "MovementGround"
    ]
  },
  "MovementWalkDust": {
    "id": "gpu:MovementWalkDust",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MovementWalkDust",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "MovementGround"
    ]
  },
  "MovementDashDust": {
    "id": "gpu:MovementDashDust",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MovementDashDust",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "MovementGround"
    ]
  },
  "BurrowClod": {
    "id": "gpu:BurrowClod",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BurrowClod",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "WorldDebris"
    ]
  },
  "BurrowGrain": {
    "id": "gpu:BurrowGrain",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BurrowGrain",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "WorldDebris"
    ]
  },
  "BurrowResidue": {
    "id": "gpu:BurrowResidue",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BurrowResidue",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "MovementGround"
    ]
  },
  "BurrowDust": {
    "id": "gpu:BurrowDust",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BurrowDust",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "MovementGround"
    ]
  },
  "BurrowShockwave": {
    "id": "gpu:BurrowShockwave",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "BurrowShockwave",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionAccent"
    ]
  },
  "ElectricGroundCore": {
    "id": "gpu:ElectricGroundCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ElectricGroundCore",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      5.45
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "ElectricGround"
    ]
  },
  "ElectricGroundGlow": {
    "id": "gpu:ElectricGroundGlow",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ElectricGroundGlow",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      5.45
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "ElectricGround"
    ]
  },
  "ElectricBodyCore": {
    "id": "gpu:ElectricBodyCore",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ElectricBodyCore",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "ElectricBody"
    ]
  },
  "ElectricBodyGlow": {
    "id": "gpu:ElectricBodyGlow",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ElectricBodyGlow",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "ElectricBody"
    ]
  },
  "MgAttrition": {
    "id": "gpu:MgAttrition",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MgAttrition",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.23
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "EntityBurn"
    ]
  },
  "MgBleed": {
    "id": "gpu:MgBleed",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MgBleed",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      24.9
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "GoreNormal"
    ]
  },
  "MgTransfer": {
    "id": "gpu:MgTransfer",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "MgTransfer",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      10.3
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "ElectricBody"
    ]
  },
  "ConstructionOwnershipMote": {
    "id": "gpu:ConstructionOwnershipMote",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "ConstructionOwnershipMote",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionAccent"
    ]
  },
  "TranslocatorPortal": {
    "id": "gpu:TranslocatorPortal",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "TranslocatorPortal",
    "height": "ground",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionAccent"
    ]
  },
  "RocketReturnBurst": {
    "id": "gpu:RocketReturnBurst",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "RocketReturnBurst",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      25.1
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "H"
    ],
    "role": "effect",
    "lanes": [
      "ExplosionAccent"
    ]
  },
  "LeafBlowerGrit": {
    "id": "gpu:LeafBlowerGrit",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "LeafBlowerGrit",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "WorldDebris"
    ]
  },
  "LeafBlowerStreak": {
    "id": "gpu:LeafBlowerStreak",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "LeafBlowerStreak",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "MovementGround"
    ]
  },
  "LeafBlowerSpray": {
    "id": "gpu:LeafBlowerSpray",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "LeafBlowerSpray",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      16.075
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "WorldDebris"
    ]
  },
  "LeafBlowerRipple": {
    "id": "gpu:LeafBlowerRipple",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "LeafBlowerRipple",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.25
    ],
    "blends": [
      "ADD"
    ],
    "profiles": [
      "G"
    ],
    "role": "effect",
    "lanes": [
      "WaterSurface"
    ]
  },
  "TrainDust": {
    "id": "gpu:TrainDust",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "TrainDust",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      11.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "TrainBody"
    ]
  },
  "TrainSmoke": {
    "id": "gpu:TrainSmoke",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "TrainSmoke",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      18.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "L"
    ],
    "role": "effect",
    "lanes": [
      "TrainSmoke"
    ]
  },
  "TrainHeat": {
    "id": "gpu:TrainHeat",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "TrainHeat",
    "height": "body",
    "lighting": "emissive",
    "camera": "world",
    "depths": [
      19.7
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "E"
    ],
    "role": "effect",
    "lanes": [
      "TrainHeat"
    ]
  },
  "TrainDebris": {
    "id": "gpu:TrainDebris",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "TrainDebris",
    "height": "body",
    "lighting": "material",
    "camera": "world",
    "depths": [
      11.1
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "K"
    ],
    "role": "effect",
    "lanes": [
      "TrainBody"
    ]
  },
  "TrainResidue": {
    "id": "gpu:TrainResidue",
    "owner": "effects/gpu/GpuVfxEffects.ts",
    "component": "TrainResidue",
    "height": "ground",
    "lighting": "material",
    "camera": "world",
    "depths": [
      5.35
    ],
    "blends": [
      "NORMAL"
    ],
    "profiles": [
      "M"
    ],
    "role": "effect",
    "lanes": [
      "TrainGround"
    ]
  }
} as const satisfies Record<keyof typeof GpuVfxEffectId, LayerContract & {readonly lanes: readonly (keyof typeof GpuVfxLaneId)[]}>;
export const CPU_LAYER_CONTRACTS: readonly LayerContract[] = [
  {"id":"cpu:adrenalineEssence/AdrenalineEssenceGpuRenderer.ts:module/this.glow/setDepth/0","owner":"adrenalineEssence/AdrenalineEssenceGpuRenderer.ts","component":"module/this.glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.39],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.glow/setDepth/0","expression":"GLOW_DEPTH"}},
  {"id":"cpu:adrenalineEssence/AdrenalineEssenceGpuRenderer.ts:module/this.body/setDepth/0","owner":"adrenalineEssence/AdrenalineEssenceGpuRenderer.ts","component":"module/this.body/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.4],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.body/setDepth/0","expression":"BODY_DEPTH"}},
  {"id":"cpu:arena/BaseAccentGlowRenderer.ts:module/overlay/setDepth/0","owner":"arena/BaseAccentGlowRenderer.ts","component":"module/overlay/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[4.04,4.05],"blends":["ADD"],"profiles":["G"],"role":"effect","source":{"selector":"module/overlay/setDepth/0","expression":"source.depth + depth"}},
  {"id":"cpu:effects/AirstrikeRenderer.ts:createVisual/warningFill/setDepth/0","owner":"effects/AirstrikeRenderer.ts","component":"createVisual/warningFill/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/warningFill/setDepth/0","expression":"DEPTH.CANOPY - 1"}},
  {"id":"cpu:effects/AirstrikeRenderer.ts:createVisual/warningRing/setDepth/0","owner":"effects/AirstrikeRenderer.ts","component":"createVisual/warningRing/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[20],"blends":["ADD"],"profiles":["E","H"],"role":"effect","source":{"selector":"createVisual/warningRing/setDepth/0","expression":"DEPTH.CANOPY"}},
  {"id":"cpu:effects/AirstrikeRenderer.ts:createVisual/innerRing/setDepth/0","owner":"effects/AirstrikeRenderer.ts","component":"createVisual/innerRing/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/innerRing/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:effects/AirstrikeRenderer.ts:createVisual/coreGlow/setDepth/0","owner":"effects/AirstrikeRenderer.ts","component":"createVisual/coreGlow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/coreGlow/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:effects/AirstrikeRenderer.ts:createVisual/crossH/setDepth/0","owner":"effects/AirstrikeRenderer.ts","component":"createVisual/crossH/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/crossH/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:effects/AirstrikeRenderer.ts:createVisual/crossV/setDepth/0","owner":"effects/AirstrikeRenderer.ts","component":"createVisual/crossV/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/crossV/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:effects/Ak47StrategicTargetRenderer.ts:build/container/setDepth/0","owner":"effects/Ak47StrategicTargetRenderer.ts","component":"build/container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[17],"blends":["NORMAL"],"profiles":["L"],"role":"ui","source":{"selector":"build/container/setDepth/0","expression":"DEPTH.PROJECTILES + 2"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playTracer/segment/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playTracer/segment/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.02,16.07],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playTracer/segment/setDepth/0","expression":"DEPTH_TRACE + 0.02 + centerT * 0.05"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playImpact/halo/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playImpact/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/halo/setDepth/0","expression":"DEPTH_TRACE + 0.1"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playImpact/flash/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playImpact/flash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.13],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/flash/setDepth/0","expression":"DEPTH_TRACE + 0.13"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playImpact/sparks/createEmitter/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playImpact/sparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.12],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/sparks/createEmitter/0","expression":"DEPTH_TRACE + 0.12"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playMuzzleBurst/bloom/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playMuzzleBurst/bloom/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playMuzzleBurst/bloom/setDepth/0","expression":"DEPTH_TRACE + 0.1"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playMuzzleBurst/flare/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playMuzzleBurst/flare/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.11],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playMuzzleBurst/flare/setDepth/0","expression":"DEPTH_TRACE + 0.11"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playMuzzleBurst/core/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playMuzzleBurst/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.12],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playMuzzleBurst/core/setDepth/0","expression":"DEPTH_TRACE + 0.12"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playMuzzleBurst/sparks/createEmitter/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playMuzzleBurst/sparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.13],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playMuzzleBurst/sparks/createEmitter/0","expression":"DEPTH_TRACE + 0.13"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playBeamParticles/flow/createEmitter/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playBeamParticles/flow/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.08],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playBeamParticles/flow/createEmitter/0","expression":"DEPTH_TRACE + 0.08"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playBeamParticles/front/createEmitter/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playBeamParticles/front/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playBeamParticles/front/createEmitter/0","expression":"DEPTH_TRACE + 0.1"}},
  {"id":"cpu:effects/AsmdPrimaryRenderer.ts:playImpactArcs/gfx/setDepth/0","owner":"effects/AsmdPrimaryRenderer.ts","component":"playImpactArcs/gfx/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.14],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactArcs/gfx/setDepth/0","expression":"DEPTH_TRACE + 0.14"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:syncVisuals/image/setDepth/0","owner":"effects/AttackDroneRenderer.ts","component":"syncVisuals/image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.1],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"syncVisuals/image/setDepth/0","expression":"DEPTH.ROCKS + .1"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:syncVisuals/setDepth/setDepth/0","owner":"effects/AttackDroneRenderer.ts","component":"syncVisuals/setDepth/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.5],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"syncVisuals/setDepth/setDepth/0","expression":"DEPTH.PROJECTILES + .5"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:createDrone/marker/setDepth/0","owner":"effects/AttackDroneRenderer.ts","component":"createDrone/marker/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.42],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createDrone/marker/setDepth/0","expression":"depth + .02"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:createDrone/this.scene.add/setDepth/0","owner":"effects/AttackDroneRenderer.ts","component":"createDrone/this.scene.add/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.4],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createDrone/this.scene.add/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:createDrone/this.scene.add/setDepth/1","owner":"effects/AttackDroneRenderer.ts","component":"createDrone/this.scene.add/setDepth/1","height":"body","lighting":"material","camera":"world","depths":[15.41],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createDrone/this.scene.add/setDepth/1","expression":"depth + .01"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:createDrone/this.scene.add/setDepth/2","owner":"effects/AttackDroneRenderer.ts","component":"createDrone/this.scene.add/setDepth/2","height":"body","lighting":"material","camera":"world","depths":[8.99],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createDrone/this.scene.add/setDepth/2","expression":"DEPTH.ROCKS - .01"}},
  {"id":"cpu:effects/AttackDroneRenderer.ts:createDrone/this.scene.add/setDepth/3","owner":"effects/AttackDroneRenderer.ts","component":"createDrone/this.scene.add/setDepth/3","height":"body","lighting":"material","camera":"world","depths":[15.43],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createDrone/this.scene.add/setDepth/3","expression":"depth + .03"}},
  {"id":"cpu:effects/BfgRenderer.ts:createVisual/coreEmitter/createEmitter/0","owner":"effects/BfgRenderer.ts","component":"createVisual/coreEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.05],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/coreEmitter/createEmitter/0","expression":"DEPTH_BFG + 0.05"}},
  {"id":"cpu:effects/BfgRenderer.ts:createVisual/outerEmitter/createEmitter/0","owner":"effects/BfgRenderer.ts","component":"createVisual/outerEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/outerEmitter/createEmitter/0","expression":"DEPTH_BFG"}},
  {"id":"cpu:effects/BfgRenderer.ts:createVisual/sparkEmitter/createEmitter/0","owner":"effects/BfgRenderer.ts","component":"createVisual/sparkEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/sparkEmitter/createEmitter/0","expression":"DEPTH_SPARK"}},
  {"id":"cpu:effects/BfgRenderer.ts:createVisual/glowImage/configureAdditiveImage/0","owner":"effects/BfgRenderer.ts","component":"createVisual/glowImage/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.9],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glowImage/configureAdditiveImage/0","expression":"DEPTH_BFG - 0.1"}},
  {"id":"cpu:effects/BfgRenderer.ts:createBeamVisual/root/setDepth/0","owner":"effects/BfgRenderer.ts","component":"createBeamVisual/root/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.18],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createBeamVisual/root/setDepth/0","expression":"BFG_BEAM_DEPTH"}},
  {"id":"cpu:effects/BiteRenderer.ts:playSwing/slash/setDepth/0","owner":"effects/BiteRenderer.ts","component":"playSwing/slash/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.04],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playSwing/slash/setDepth/0","expression":"DEPTH_TRACE + 0.04"}},
  {"id":"cpu:effects/BiteRenderer.ts:playClawWake/wake/setDepth/0","owner":"effects/BiteRenderer.ts","component":"playClawWake/wake/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.08],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playClawWake/wake/setDepth/0","expression":"DEPTH_TRACE + 0.08"}},
  {"id":"cpu:effects/BiteRenderer.ts:playVolumeParticles/blood/createEmitter/0","owner":"effects/BiteRenderer.ts","component":"playVolumeParticles/blood/createEmitter/0","height":"body","lighting":"material","camera":"world","depths":[16.1],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playVolumeParticles/blood/createEmitter/0","expression":"DEPTH_TRACE + 0.1"}},
  {"id":"cpu:effects/BiteRenderer.ts:playVolumeParticles/flecks/createEmitter/0","owner":"effects/BiteRenderer.ts","component":"playVolumeParticles/flecks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.11],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playVolumeParticles/flecks/createEmitter/0","expression":"DEPTH_TRACE + 0.11"}},
  {"id":"cpu:effects/BiteRenderer.ts:playImpactBurst/mark/setDepth/0","owner":"effects/BiteRenderer.ts","component":"playImpactBurst/mark/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.14],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/mark/setDepth/0","expression":"DEPTH_TRACE + 0.14"}},
  {"id":"cpu:effects/BiteRenderer.ts:playImpactBurst/gore/setDepth/0","owner":"effects/BiteRenderer.ts","component":"playImpactBurst/gore/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.145],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/gore/setDepth/0","expression":"DEPTH_TRACE + 0.145"}},
  {"id":"cpu:effects/BiteRenderer.ts:playImpactBurst/mist/setDepth/0","owner":"effects/BiteRenderer.ts","component":"playImpactBurst/mist/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.146],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/mist/setDepth/0","expression":"DEPTH_TRACE + 0.146"}},
  {"id":"cpu:effects/BiteRenderer.ts:playImpactBurst/blood/createEmitter/0","owner":"effects/BiteRenderer.ts","component":"playImpactBurst/blood/createEmitter/0","height":"body","lighting":"material","camera":"world","depths":[16.16],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/blood/createEmitter/0","expression":"DEPTH_TRACE + 0.16"}},
  {"id":"cpu:effects/BiteRenderer.ts:playImpactBurst/chips/createEmitter/0","owner":"effects/BiteRenderer.ts","component":"playImpactBurst/chips/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.17],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/chips/createEmitter/0","expression":"DEPTH_TRACE + 0.17"}},
  {"id":"cpu:effects/BiteRenderer.ts:playAirSnap/snap/setDepth/0","owner":"effects/BiteRenderer.ts","component":"playAirSnap/snap/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.12],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playAirSnap/snap/setDepth/0","expression":"DEPTH_TRACE + 0.12"}},
  {"id":"cpu:effects/BlackHoleRenderer.ts:play/core/setDepth/0","owner":"effects/BlackHoleRenderer.ts","component":"play/core/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.9],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"play/core/setDepth/0","expression":"DEPTH.FIRE - 0.1"}},
  {"id":"cpu:effects/BlackHoleRenderer.ts:play/horizon/setDepth/0","owner":"effects/BlackHoleRenderer.ts","component":"play/horizon/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.93],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"play/horizon/setDepth/0","expression":"DEPTH.FIRE - 0.07"}},
  {"id":"cpu:effects/BlackHoleRenderer.ts:play/collapseRipple/setDepth/0","owner":"effects/BlackHoleRenderer.ts","component":"play/collapseRipple/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.965],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"play/collapseRipple/setDepth/0","expression":"DEPTH.FIRE - 0.035"}},
  {"id":"cpu:effects/BlackHoleRenderer.ts:play/outerOrbitEmitter/createEmitter/0","owner":"effects/BlackHoleRenderer.ts","component":"play/outerOrbitEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.945],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"play/outerOrbitEmitter/createEmitter/0","expression":"DEPTH.FIRE - 0.055"}},
  {"id":"cpu:effects/BlackHoleRenderer.ts:play/wispEmitter/createEmitter/0","owner":"effects/BlackHoleRenderer.ts","component":"play/wispEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.948],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"play/wispEmitter/createEmitter/0","expression":"DEPTH.FIRE - 0.052"}},
  {"id":"cpu:effects/BlackHoleRenderer.ts:play/innerOrbitEmitter/createEmitter/0","owner":"effects/BlackHoleRenderer.ts","component":"play/innerOrbitEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.95],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"play/innerOrbitEmitter/createEmitter/0","expression":"DEPTH.FIRE - 0.05"}},
  {"id":"cpu:effects/BloodEffectShared.ts:spawnBloodStain/stain/setDepth/0","owner":"effects/BloodEffectShared.ts","component":"spawnBloodStain/stain/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"spawnBloodStain/stain/setDepth/0","expression":"config.depth"}},
  {"id":"cpu:effects/BulletRenderer.ts:createVisual/bullet/setDepth/0","owner":"effects/BulletRenderer.ts","component":"createVisual/bullet/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/bullet/setDepth/0","expression":"DEPTH_BULLET"}},
  {"id":"cpu:effects/BulletRenderer.ts:createVisual/accent/configureAdditiveImage/0","owner":"effects/BulletRenderer.ts","component":"createVisual/accent/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/accent/configureAdditiveImage/0","expression":"DEPTH_ACCENT"}},
  {"id":"cpu:effects/BulletRenderer.ts:createVisual/trail/setDepth/0","owner":"effects/BulletRenderer.ts","component":"createVisual/trail/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createVisual/trail/setDepth/0","expression":"DEPTH_TRAIL"}},
  {"id":"cpu:effects/BulletRenderer.ts:createVisual/glow/configureAdditiveImage/0","owner":"effects/BulletRenderer.ts","component":"createVisual/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createVisual/glow/configureAdditiveImage/0","expression":"DEPTH_GLOW"}},
  {"id":"cpu:effects/BulletRenderer.ts:createChargeFx/aura/configureAdditiveImage/0","owner":"effects/BulletRenderer.ts","component":"createChargeFx/aura/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14.5],"blends":["ADD"],"profiles":["K","L"],"role":"effect","source":{"selector":"createChargeFx/aura/configureAdditiveImage/0","expression":"DEPTH_AURA"}},
  {"id":"cpu:effects/BulletRenderer.ts:playImpactSparks/emitter/setDepth/0","owner":"effects/BulletRenderer.ts","component":"playImpactSparks/emitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactSparks/emitter/setDepth/0","expression":"DEPTH_SPARK"}},
  {"id":"cpu:effects/BulletRenderer.ts:playImpactSparks/impactFlash/configureAdditiveImage/0","owner":"effects/BulletRenderer.ts","component":"playImpactSparks/impactFlash/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactSparks/impactFlash/configureAdditiveImage/0","expression":"DEPTH_SPARK"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:update/visual.container/setDepth/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"update/visual.container/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[24.32,24.55],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"update/visual.container/setDepth/0","expression":"isCarried ? BEER_DEPTH + 0.35 : BEER_DEPTH + 0.12"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:createVisual/container/setDepth/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"createVisual/container/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[24.2],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"createVisual/container/setDepth/0","expression":"BEER_DEPTH"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:createVisual/outerGlow/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"createVisual/outerGlow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[24],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"createVisual/outerGlow/configureAdditiveImage/0","expression":"BEER_DEPTH - 0.2"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:createVisual/innerGlow/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"createVisual/innerGlow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[24.1],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"createVisual/innerGlow/configureAdditiveImage/0","expression":"BEER_DEPTH - 0.1"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:createVisual/aura/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"createVisual/aura/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[24.15],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"createVisual/aura/configureAdditiveImage/0","expression":"BEER_DEPTH - 0.05"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:createVisual/idleEmitter/createEmitter/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"createVisual/idleEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[24.46],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"createVisual/idleEmitter/createEmitter/0","expression":"BEER_DEPTH + 0.26"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:createVisual/bubbleEmitter/createEmitter/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"createVisual/bubbleEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[24.42],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"createVisual/bubbleEmitter/createEmitter/0","expression":"BEER_DEPTH + 0.22"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:spawnTrailPuff/foam/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"spawnTrailPuff/foam/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[24.24],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"spawnTrailPuff/foam/configureAdditiveImage/0","expression":"BEER_DEPTH + 0.04"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:spawnTrailPuff/bubble/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"spawnTrailPuff/bubble/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[24.28],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"spawnTrailPuff/bubble/configureAdditiveImage/0","expression":"BEER_DEPTH + 0.08"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playResetTeleport/halo/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playResetTeleport/halo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[25.9],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playResetTeleport/halo/configureAdditiveImage/0","expression":"DEPTH_FX + 0.9"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:spawnTeleportSwirl/bubble/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"spawnTeleportSwirl/bubble/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[25.82],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"spawnTeleportSwirl/bubble/configureAdditiveImage/0","expression":"DEPTH_FX + 0.82"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playFoamBurst/foamEmitter/createEmitter/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playFoamBurst/foamEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[25.66],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playFoamBurst/foamEmitter/createEmitter/0","expression":"DEPTH_FX + 0.66"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playFoamBurst/bubbleEmitter/createEmitter/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playFoamBurst/bubbleEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[25.7],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playFoamBurst/bubbleEmitter/createEmitter/0","expression":"DEPTH_FX + 0.7"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playPulseHalo/halo/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playPulseHalo/halo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[25.52],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playPulseHalo/halo/configureAdditiveImage/0","expression":"DEPTH_FX + 0.52"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreScreenFlash/colorWash/setDepth/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreScreenFlash/colorWash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26.75],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreScreenFlash/colorWash/setDepth/0","expression":"DEPTH_FX + 1.75"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreScreenFlash/whiteWash/setDepth/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreScreenFlash/whiteWash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26.8],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreScreenFlash/whiteWash/setDepth/0","expression":"DEPTH_FX + 1.8"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreScreenFlash/centerHalo/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreScreenFlash/centerHalo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[26.82],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreScreenFlash/centerHalo/configureAdditiveImage/0","expression":"DEPTH_FX + 1.82"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreScreenFlash/centerCore/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreScreenFlash/centerCore/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[26.84],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreScreenFlash/centerCore/configureAdditiveImage/0","expression":"DEPTH_FX + 1.84"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreLightBurst/beam/setDepth/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreLightBurst/beam/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.95],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreLightBurst/beam/setDepth/0","expression":"DEPTH_FX + 0.95"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreLightBurst/core/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreLightBurst/core/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[26.02],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreLightBurst/core/configureAdditiveImage/0","expression":"DEPTH_FX + 1.02"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreLightBurst/corona/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreLightBurst/corona/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[26.01],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreLightBurst/corona/configureAdditiveImage/0","expression":"DEPTH_FX + 1.01"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreFoamShell/shell/createEmitter/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreFoamShell/shell/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[25.86],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreFoamShell/shell/createEmitter/0","expression":"DEPTH_FX + 0.86"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playScoreFoamShell/plume/createEmitter/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playScoreFoamShell/plume/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[25.88],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playScoreFoamShell/plume/createEmitter/0","expression":"DEPTH_FX + 0.88"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:playRing/ring/setDepth/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"playRing/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.6],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playRing/ring/setDepth/0","expression":"DEPTH_FX + 0.6"}},
  {"id":"cpu:effects/CaptureTheBeerRenderer.ts:spawnAfterglow/afterglow/configureAdditiveImage/0","owner":"effects/CaptureTheBeerRenderer.ts","component":"spawnAfterglow/afterglow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[25.3],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"spawnAfterglow/afterglow/configureAdditiveImage/0","expression":"DEPTH_FX + 0.3"}},
  {"id":"cpu:effects/ConstructionOwnershipGpuSystem.ts:module/this.passiveLayer/setDepth/0","owner":"effects/ConstructionOwnershipGpuSystem.ts","component":"module/this.passiveLayer/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[8.9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"module/this.passiveLayer/setDepth/0","expression":"DEPTH.ROCKS - 0.1"}},
  {"id":"cpu:effects/ConstructionOwnershipGpuSystem.ts:module/this.activeLayer/setDepth/0","owner":"effects/ConstructionOwnershipGpuSystem.ts","component":"module/this.activeLayer/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.3],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.activeLayer/setDepth/0","expression":"DEPTH.ROCKS + 0.3"}},
  {"id":"cpu:effects/CoopDefenseCarryZoneRenderer.ts:createVisual/spawn/setDepth/0","owner":"effects/CoopDefenseCarryZoneRenderer.ts","component":"createVisual/spawn/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[5.35],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/spawn/setDepth/0","expression":"DEPTH.GROUND_FOG + 0.05"}},
  {"id":"cpu:effects/CoopDefenseCarryZoneRenderer.ts:createVisual/delivery/setDepth/0","owner":"effects/CoopDefenseCarryZoneRenderer.ts","component":"createVisual/delivery/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[5.4],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/delivery/setDepth/0","expression":"DEPTH.GROUND_FOG + 0.1"}},
  {"id":"cpu:effects/CoopDefenseEncounterTelegraphRenderer.ts:module/this.graphics/setDepth/0","owner":"effects/CoopDefenseEncounterTelegraphRenderer.ts","component":"module/this.graphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25],"blends":["ADD"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.graphics/setDepth/0","expression":"DEPTH_FX"}},
  {"id":"cpu:effects/CoopDefenseEncounterTelegraphRenderer.ts:generateTextures/edge/setDepth/0","owner":"effects/CoopDefenseEncounterTelegraphRenderer.ts","component":"generateTextures/edge/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[24.9],"blends":["ADD"],"profiles":["H"],"role":"ui","source":{"selector":"generateTextures/edge/setDepth/0","expression":"DEPTH_FX - 0.1"}},
  {"id":"cpu:effects/CoopDefenseEncounterTelegraphRenderer.ts:generateTextures/haze/setDepth/0","owner":"effects/CoopDefenseEncounterTelegraphRenderer.ts","component":"generateTextures/haze/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[24.8],"blends":["ADD"],"profiles":["H"],"role":"ui","source":{"selector":"generateTextures/haze/setDepth/0","expression":"DEPTH_FX - 0.2"}},
  {"id":"cpu:effects/CoopDefenseEncounterTelegraphRenderer.ts:generateTextures/drift/setDepth/0","owner":"effects/CoopDefenseEncounterTelegraphRenderer.ts","component":"generateTextures/drift/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.1],"blends":["ADD"],"profiles":["H"],"role":"ui","source":{"selector":"generateTextures/drift/setDepth/0","expression":"DEPTH_FX + 0.1"}},
  {"id":"cpu:effects/CoopDefenseEncounterTelegraphRenderer.ts:generateTextures/crest/setDepth/0","owner":"effects/CoopDefenseEncounterTelegraphRenderer.ts","component":"generateTextures/crest/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.15],"blends":["ADD"],"profiles":["H"],"role":"ui","source":{"selector":"generateTextures/crest/setDepth/0","expression":"DEPTH_FX + 0.15"}},
  {"id":"cpu:effects/CoopDefenseMissionProgressRenderer.ts:createCheckpoints/quad/setDepth/0","owner":"effects/CoopDefenseMissionProgressRenderer.ts","component":"createCheckpoints/quad/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[8.5],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createCheckpoints/quad/setDepth/0","expression":"DEPTH.ROCKS - 0.5"}},
  {"id":"cpu:effects/CoopDefenseMissionProgressRenderer.ts:syncBarriers/image/setDepth/0","owner":"effects/CoopDefenseMissionProgressRenderer.ts","component":"syncBarriers/image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"syncBarriers/image/setDepth/0","expression":"DEPTH.ROCKS"}},
  {"id":"cpu:effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts:build/container/setDepth/0","owner":"effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts","component":"build/container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"ui","source":{"selector":"build/container/setDepth/0","expression":"DEPTH.BASES + 8"}},
  {"id":"cpu:effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts:build/arrow/setDepth/0","owner":"effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts","component":"build/arrow/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[100],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/arrow/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts:build/label/setDepth/0","owner":"effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts","component":"build/label/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[100],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/label/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:effects/CoopXpTextRenderer.ts:createPopup/outline/setDepth/0","owner":"effects/CoopXpTextRenderer.ts","component":"createPopup/outline/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[95],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"createPopup/outline/setDepth/0","expression":"DEPTH.OVERLAY - 5"}},
  {"id":"cpu:effects/CoopXpTextRenderer.ts:createPopup/label/setDepth/0","owner":"effects/CoopXpTextRenderer.ts","component":"createPopup/label/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[95],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"createPopup/label/setDepth/0","expression":"DEPTH.OVERLAY - 5"}},
  {"id":"cpu:effects/CorpseMarkerRenderer.ts:show/shadow/setDepth/0","owner":"effects/CorpseMarkerRenderer.ts","component":"show/shadow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[5.39],"blends":["NORMAL"],"profiles":["M"],"role":"ui","source":{"selector":"show/shadow/setDepth/0","expression":"DEPTH_CORPSE_CROSS_SHADOW"}},
  {"id":"cpu:effects/CorpseMarkerRenderer.ts:show/cross/setDepth/0","owner":"effects/CorpseMarkerRenderer.ts","component":"show/cross/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[5.4],"blends":["NORMAL"],"profiles":["M"],"role":"ui","source":{"selector":"show/cross/setDepth/0","expression":"DEPTH_CORPSE_CROSS"}},
  {"id":"cpu:effects/EffectSystem.ts:playTrainExplosionEffect/flash/setDepth/0","owner":"effects/EffectSystem.ts","component":"playTrainExplosionEffect/flash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playTrainExplosionEffect/flash/setDepth/0","expression":"DEPTH_FX + 1"}},
  {"id":"cpu:effects/EffectSystem.ts:playTrainExplosionEffect/skyFlash/setDepth/0","owner":"effects/EffectSystem.ts","component":"playTrainExplosionEffect/skyFlash/setDepth/0","height":"high","lighting":"emissive","camera":"world","depths":[98],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playTrainExplosionEffect/skyFlash/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:effects/EffectSystem.ts:playHitEffect/criticalRing/setDepth/0","owner":"effects/EffectSystem.ts","component":"playHitEffect/criticalRing/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.35],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playHitEffect/criticalRing/setDepth/0","expression":"DEPTH_FX + 0.35"}},
  {"id":"cpu:effects/EffectSystem.ts:playHitEffect/criticalLabel/setDepth/0","owner":"effects/EffectSystem.ts","component":"playHitEffect/criticalLabel/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.4],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playHitEffect/criticalLabel/setDepth/0","expression":"DEPTH_FX + 0.4"}},
  {"id":"cpu:effects/EffectSystem.ts:playDashTrailGhost/ghost/setDepth/0","owner":"effects/EffectSystem.ts","component":"playDashTrailGhost/ghost/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[24],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playDashTrailGhost/ghost/setDepth/0","expression":"DEPTH_FX - 1"}},
  {"id":"cpu:effects/EffectSystem.ts:playTrainBurrowSparks/sparks/setDepth/0","owner":"effects/EffectSystem.ts","component":"playTrainBurrowSparks/sparks/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.35],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playTrainBurrowSparks/sparks/setDepth/0","expression":"DEPTH_FX + 0.35"}},
  {"id":"cpu:effects/EffectSystem.ts:playStealthTransitionEffect/core/setDepth/0","owner":"effects/EffectSystem.ts","component":"playStealthTransitionEffect/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.2],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playStealthTransitionEffect/core/setDepth/0","expression":"DEPTH_FX + 0.2"}},
  {"id":"cpu:effects/EffectSystem.ts:playStealthTransitionEffect/ring/setDepth/0","owner":"effects/EffectSystem.ts","component":"playStealthTransitionEffect/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.16],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playStealthTransitionEffect/ring/setDepth/0","expression":"DEPTH_FX + 0.16"}},
  {"id":"cpu:effects/EffectSystem.ts:playStealthTransitionEffect/outerRing/setDepth/0","owner":"effects/EffectSystem.ts","component":"playStealthTransitionEffect/outerRing/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.12],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playStealthTransitionEffect/outerRing/setDepth/0","expression":"DEPTH_FX + 0.12"}},
  {"id":"cpu:effects/EffectSystem.ts:playStealthTransitionEffect/pixel/setDepth/0","owner":"effects/EffectSystem.ts","component":"playStealthTransitionEffect/pixel/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.1],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playStealthTransitionEffect/pixel/setDepth/0","expression":"DEPTH_FX + 0.1"}},
  {"id":"cpu:effects/EffectSystem.ts:playStealthTransitionEffect/dust/setDepth/0","owner":"effects/EffectSystem.ts","component":"playStealthTransitionEffect/dust/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.05],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playStealthTransitionEffect/dust/setDepth/0","expression":"DEPTH_FX + 0.05"}},
  {"id":"cpu:effects/EffectSystem.ts:playStealthTransitionEffect/spark/setDepth/0","owner":"effects/EffectSystem.ts","component":"playStealthTransitionEffect/spark/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.22],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playStealthTransitionEffect/spark/setDepth/0","expression":"DEPTH_FX + 0.22"}},
  {"id":"cpu:effects/EffectSystem.ts:ensureBurrowVisual/dirt/setDepth/0","owner":"effects/EffectSystem.ts","component":"ensureBurrowVisual/dirt/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[24.8],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"ensureBurrowVisual/dirt/setDepth/0","expression":"DEPTH_FX - 0.2"}},
  {"id":"cpu:effects/EffectSystem.ts:ensureBurrowVisual/dust/setDepth/0","owner":"effects/EffectSystem.ts","component":"ensureBurrowVisual/dust/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[24.75],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"ensureBurrowVisual/dust/setDepth/0","expression":"DEPTH_FX - 0.25"}},
  {"id":"cpu:effects/EffectSystem.ts:playBurrowPhaseEffect/ring/setDepth/0","owner":"effects/EffectSystem.ts","component":"playBurrowPhaseEffect/ring/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.05],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playBurrowPhaseEffect/ring/setDepth/0","expression":"DEPTH_FX + 0.05"}},
  {"id":"cpu:effects/EffectSystem.ts:playBurrowPhaseEffect/dirtBurst/setDepth/0","owner":"effects/EffectSystem.ts","component":"playBurrowPhaseEffect/dirtBurst/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.08],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playBurrowPhaseEffect/dirtBurst/setDepth/0","expression":"DEPTH_FX + 0.08"}},
  {"id":"cpu:effects/EffectSystem.ts:playBurrowPhaseEffect/plume/setDepth/0","owner":"effects/EffectSystem.ts","component":"playBurrowPhaseEffect/plume/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.1],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playBurrowPhaseEffect/plume/setDepth/0","expression":"DEPTH_FX + 0.1"}},
  {"id":"cpu:effects/EffectSystem.ts:playExplosionEffect/core/setDepth/0","owner":"effects/EffectSystem.ts","component":"playExplosionEffect/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.4],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playExplosionEffect/core/setDepth/0","expression":"DEPTH_FX + 0.4"}},
  {"id":"cpu:effects/EffectSystem.ts:playExplosionEffect/skyFlash/setDepth/0","owner":"effects/EffectSystem.ts","component":"playExplosionEffect/skyFlash/setDepth/0","height":"high","lighting":"emissive","camera":"world","depths":[98],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playExplosionEffect/skyFlash/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:effects/EffectSystem.ts:playExplosionEffect/flash/setDepth/0","owner":"effects/EffectSystem.ts","component":"playExplosionEffect/flash/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[26],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playExplosionEffect/flash/setDepth/0","expression":"DEPTH_FX + 1"}},
  {"id":"cpu:effects/EffectSystem.ts:playExplosionEffect/skyFlash/setDepth/1","owner":"effects/EffectSystem.ts","component":"playExplosionEffect/skyFlash/setDepth/1","height":"high","lighting":"emissive","camera":"world","depths":[98],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playExplosionEffect/skyFlash/setDepth/1","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:effects/EffectSystem.ts:playLightningExplosionEffect/flash/setDepth/0","owner":"effects/EffectSystem.ts","component":"playLightningExplosionEffect/flash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.45],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playLightningExplosionEffect/flash/setDepth/0","expression":"DEPTH_FX + 0.45"}},
  {"id":"cpu:effects/EffectSystem.ts:playLightningExplosionEffect/arcs/setDepth/0","owner":"effects/EffectSystem.ts","component":"playLightningExplosionEffect/arcs/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.35],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playLightningExplosionEffect/arcs/setDepth/0","expression":"DEPTH_FX + 0.35"}},
  {"id":"cpu:effects/EffectSystem.ts:playBroodHatchEffect/lobe/setDepth/0","owner":"effects/EffectSystem.ts","component":"playBroodHatchEffect/lobe/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.12],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playBroodHatchEffect/lobe/setDepth/0","expression":"DEPTH_FX + 0.12"}},
  {"id":"cpu:effects/EffectSystem.ts:playRegenerationEffect/core/setDepth/0","owner":"effects/EffectSystem.ts","component":"playRegenerationEffect/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.4],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playRegenerationEffect/core/setDepth/0","expression":"DEPTH_FX + 0.4"}},
  {"id":"cpu:effects/EffectSystem.ts:playRegenerationEffect/ring/setDepth/0","owner":"effects/EffectSystem.ts","component":"playRegenerationEffect/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.26,25.28,25.3],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playRegenerationEffect/ring/setDepth/0","expression":"DEPTH_FX + 0.3 - ringIndex * 0.02"}},
  {"id":"cpu:effects/EffectSystem.ts:playCountdownText/label/setDepth/0","owner":"effects/EffectSystem.ts","component":"playCountdownText/label/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[95],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playCountdownText/label/setDepth/0","expression":"DEPTH.OVERLAY - 5"}},
  {"id":"cpu:effects/EffectSystem.ts:playHitscanTracer/gfx/setDepth/0","owner":"effects/EffectSystem.ts","component":"playHitscanTracer/gfx/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playHitscanTracer/gfx/setDepth/0","expression":"DEPTH_TRACE"}},
  {"id":"cpu:effects/EffectSystem.ts:playHitscanImpact/halo/setDepth/0","owner":"effects/EffectSystem.ts","component":"playHitscanImpact/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playHitscanImpact/halo/setDepth/0","expression":"DEPTH_TRACE + 0.1"}},
  {"id":"cpu:effects/EffectSystem.ts:playMeleeSwingEffect/gfx/setDepth/0","owner":"effects/EffectSystem.ts","component":"playMeleeSwingEffect/gfx/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playMeleeSwingEffect/gfx/setDepth/0","expression":"DEPTH_FX"}},
  {"id":"cpu:effects/EffectSystem.ts:spawnBloodStain/depth/depth/0","owner":"effects/EffectSystem.ts","component":"spawnBloodStain/depth/depth/0","height":"ground","lighting":"material","camera":"world","depths":[9.95],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"spawnBloodStain/depth/depth/0","expression":"DEPTH_BLOOD_STAIN"}},
  {"id":"cpu:effects/EffectSystem.ts:ensureDamageVignette/createEdge/setDepth/0","owner":"effects/EffectSystem.ts","component":"ensureDamageVignette/createEdge/setDepth/0","height":"body","lighting":"material","camera":"clarity","depths":[99],"blends":["NORMAL"],"profiles":["C"],"role":"effect","source":{"selector":"ensureDamageVignette/createEdge/setDepth/0","expression":"DEPTH_DAMAGE_VIGNETTE"}},
  {"id":"cpu:effects/EffectSystem.ts:playPlayerDeathAnimation/sprite/setDepth/0","owner":"effects/EffectSystem.ts","component":"playPlayerDeathAnimation/sprite/setDepth/0","height":"high","lighting":"emissive","camera":"world","depths":[25.1],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playPlayerDeathAnimation/sprite/setDepth/0","expression":"DEPTH_FX + 0.1"}},
  {"id":"cpu:effects/EffectUtils.ts:createEmitter/emitter/setDepth/0","owner":"effects/EffectUtils.ts","component":"createEmitter/emitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"createEmitter/emitter/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/EffectUtils.ts:configureAdditiveImage/image/setDepth/0","owner":"effects/EffectUtils.ts","component":"configureAdditiveImage/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[],"blends":["ADD"],"profiles":[],"role":"delegate","source":{"selector":"configureAdditiveImage/image/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/EnemyClawRenderer.ts:module/ground/createEnemyClawGpuLayer/0","owner":"effects/EnemyClawRenderer.ts","component":"module/ground/createEnemyClawGpuLayer/0","height":"ground","lighting":"material","camera":"world","depths":[9.9],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/ground/createEnemyClawGpuLayer/0","expression":"DEPTH.PLAYERS - 0.1"}},
  {"id":"cpu:effects/EnemyClawRenderer.ts:module/top/createEnemyClawGpuLayer/0","owner":"effects/EnemyClawRenderer.ts","component":"module/top/createEnemyClawGpuLayer/0","height":"body","lighting":"material","camera":"world","depths":[16],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"module/top/createEnemyClawGpuLayer/0","expression":"DEPTH_TRACE"}},
  {"id":"cpu:effects/EnemyClawRenderer.ts:module/night/createEnemyClawGpuLayer/0","owner":"effects/EnemyClawRenderer.ts","component":"module/night/createEnemyClawGpuLayer/0","height":"body","lighting":"material","camera":"world","depths":[19.58],"blends":["NORMAL"],"profiles":["E"],"role":"effect","source":{"selector":"module/night/createEnemyClawGpuLayer/0","expression":"DEPTH_LIGHTING + 0.08"}},
  {"id":"cpu:effects/EnemyEyeBatch.ts:module/this.layer/setDepth/0","owner":"effects/EnemyEyeBatch.ts","component":"module/this.layer/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"module/this.layer/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/EnemyEyeGlowRenderer.ts:module/this.aura/EnemyEyeBatch/0","owner":"effects/EnemyEyeGlowRenderer.ts","component":"module/this.aura/EnemyEyeBatch/0","height":"body","lighting":"emissive","camera":"world","depths":[19.59],"blends":["ADD"],"profiles":["E"],"role":"effect","source":{"selector":"module/this.aura/EnemyEyeBatch/0","expression":"DEPTH_LIGHTING + .09"}},
  {"id":"cpu:effects/EnemyEyeGlowRenderer.ts:module/this.socket/EnemyEyeBatch/0","owner":"effects/EnemyEyeGlowRenderer.ts","component":"module/this.socket/EnemyEyeBatch/0","height":"body","lighting":"emissive","camera":"world","depths":[19.595],"blends":["NORMAL"],"profiles":["E"],"role":"effect","source":{"selector":"module/this.socket/EnemyEyeBatch/0","expression":"DEPTH_LIGHTING + .095"}},
  {"id":"cpu:effects/EnemyEyeGlowRenderer.ts:module/this.bloom/EnemyEyeBatch/0","owner":"effects/EnemyEyeGlowRenderer.ts","component":"module/this.bloom/EnemyEyeBatch/0","height":"body","lighting":"emissive","camera":"world","depths":[19.6],"blends":["ADD"],"profiles":["E"],"role":"effect","source":{"selector":"module/this.bloom/EnemyEyeBatch/0","expression":"DEPTH_LIGHTING + .1"}},
  {"id":"cpu:effects/EnemyEyeGlowRenderer.ts:module/this.halo/EnemyEyeBatch/0","owner":"effects/EnemyEyeGlowRenderer.ts","component":"module/this.halo/EnemyEyeBatch/0","height":"body","lighting":"emissive","camera":"world","depths":[19.61],"blends":["NORMAL"],"profiles":["E"],"role":"effect","source":{"selector":"module/this.halo/EnemyEyeBatch/0","expression":"DEPTH_LIGHTING + .11"}},
  {"id":"cpu:effects/EnemyEyeGlowRenderer.ts:module/this.core/EnemyEyeBatch/0","owner":"effects/EnemyEyeGlowRenderer.ts","component":"module/this.core/EnemyEyeBatch/0","height":"body","lighting":"emissive","camera":"world","depths":[19.62],"blends":["NORMAL"],"profiles":["E"],"role":"effect","source":{"selector":"module/this.core/EnemyEyeBatch/0","expression":"DEPTH_LIGHTING + .12"}},
  {"id":"cpu:effects/EnemyReadabilityRenderer.ts:createLayer/layer/setDepth/0","owner":"effects/EnemyReadabilityRenderer.ts","component":"createLayer/layer/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.949],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"createLayer/layer/setDepth/0","expression":"s.depth - 0.001"}},
  {"id":"cpu:effects/EnemyVulnerabilityRenderer.ts:createLayer/layer/setDepth/0","owner":"effects/EnemyVulnerabilityRenderer.ts","component":"createLayer/layer/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.88,9.89,9.955,19.585],"blends":["NORMAL"],"profiles":["E","K"],"role":"effect","source":{"selector":"createLayer/layer/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:createVisual/coreEmitter/createEmitter/0","owner":"effects/EnergyBallRenderer.ts","component":"createVisual/coreEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/coreEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 1"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:createVisual/shellEmitter/createEmitter/0","owner":"effects/EnergyBallRenderer.ts","component":"createVisual/shellEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.5],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/shellEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 0.5"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:createVisual/glowImage/configureAdditiveImage/0","owner":"effects/EnergyBallRenderer.ts","component":"createVisual/glowImage/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14.8],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glowImage/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES - 0.2"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:createVisual/shellImage/configureAdditiveImage/0","owner":"effects/EnergyBallRenderer.ts","component":"createVisual/shellImage/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.8],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/shellImage/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.8"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:playImpact/glow/configureAdditiveImage/0","owner":"effects/EnergyBallRenderer.ts","component":"playImpact/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.4],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/glow/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.4"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:playImpact/shell/configureAdditiveImage/0","owner":"effects/EnergyBallRenderer.ts","component":"playImpact/shell/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.5],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/shell/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.5"}},
  {"id":"cpu:effects/EnergyBallRenderer.ts:playImpact/sparkEmitter/createEmitter/0","owner":"effects/EnergyBallRenderer.ts","component":"playImpact/sparkEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.45],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/sparkEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 1.45"}},
  {"id":"cpu:effects/EnergyInjectorRenderer.ts:createVisual/halo/setDepth/0","owner":"effects/EnergyInjectorRenderer.ts","component":"createVisual/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.8],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/halo/setDepth/0","expression":"DEPTH.PROJECTILES - 0.2"}},
  {"id":"cpu:effects/EnergyInjectorRenderer.ts:createVisual/ring/setDepth/0","owner":"effects/EnergyInjectorRenderer.ts","component":"createVisual/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.9],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/ring/setDepth/0","expression":"DEPTH.PROJECTILES - 0.1"}},
  {"id":"cpu:effects/EnergyInjectorRenderer.ts:createVisual/sparks/setDepth/0","owner":"effects/EnergyInjectorRenderer.ts","component":"createVisual/sparks/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.85],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/sparks/setDepth/0","expression":"DEPTH.PROJECTILES - 0.15"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/halo/configureAdditiveImage/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/halo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/halo/configureAdditiveImage/0","expression":"DEPTH.FIRE + 0.20"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/outerGlow/setDepth/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/outerGlow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.19],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/outerGlow/setDepth/0","expression":"DEPTH.FIRE + 0.19"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/glow/setDepth/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.22],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glow/setDepth/0","expression":"DEPTH.FIRE + 0.22"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/core/setDepth/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.24],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/core/setDepth/0","expression":"DEPTH.FIRE + 0.24"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/rimEmitter/createEmitter/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/rimEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.21],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/rimEmitter/createEmitter/0","expression":"DEPTH.FIRE + 0.21"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/flowEmitter/createEmitter/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/flowEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.23],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/flowEmitter/createEmitter/0","expression":"DEPTH.FIRE + 0.23"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/sparkEmitter/createEmitter/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/sparkEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.25],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/sparkEmitter/createEmitter/0","expression":"DEPTH.FIRE + 0.25"}},
  {"id":"cpu:effects/EnergyShieldRenderer.ts:createVisual/domeField/setDepth/0","owner":"effects/EnergyShieldRenderer.ts","component":"createVisual/domeField/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/domeField/setDepth/0","expression":"DEPTH.FIRE + 0.20"}},
  {"id":"cpu:effects/EntityBurnRenderer.ts:module/this.glowImage/setDepth/0","owner":"effects/EntityBurnRenderer.ts","component":"module/this.glowImage/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.18],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.glowImage/setDepth/0","expression":"DEPTH_BURN_GLOW"}},
  {"id":"cpu:effects/FireballRenderer.ts:module/this.tail/createEmitter/0","owner":"effects/FireballRenderer.ts","component":"module/this.tail/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[14.8],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"module/this.tail/createEmitter/0","expression":"DEPTH.PROJECTILES - 0.2"}},
  {"id":"cpu:effects/FireballRenderer.ts:module/this.sparks/createEmitter/0","owner":"effects/FireballRenderer.ts","component":"module/this.sparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"module/this.sparks/createEmitter/0","expression":"DEPTH.PROJECTILES + 0.2"}},
  {"id":"cpu:effects/FireballRenderer.ts:createVisual/glow/setDepth/0","owner":"effects/FireballRenderer.ts","component":"createVisual/glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.9],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glow/setDepth/0","expression":"DEPTH.PROJECTILES - 0.1"}},
  {"id":"cpu:effects/FireballRenderer.ts:createVisual/core/setDepth/0","owner":"effects/FireballRenderer.ts","component":"createVisual/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/core/setDepth/0","expression":"DEPTH.PROJECTILES + 0.1"}},
  {"id":"cpu:effects/FlameRenderer.ts:createVisual/glowImage/setDepth/0","owner":"effects/FlameRenderer.ts","component":"createVisual/glowImage/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.9],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glowImage/setDepth/0","expression":"DEPTH_FLAME - 0.1"}},
  {"id":"cpu:effects/FlamethrowerUpgradeRenderer.ts:playFireChunkBurst/chunk/setDepth/0","owner":"effects/FlamethrowerUpgradeRenderer.ts","component":"playFireChunkBurst/chunk/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.4],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playFireChunkBurst/chunk/setDepth/0","expression":"DEPTH.PROJECTILES + 0.4"}},
  {"id":"cpu:effects/FlamethrowerUpgradeRenderer.ts:createRingVisual/quad/setDepth/0","owner":"effects/FlamethrowerUpgradeRenderer.ts","component":"createRingVisual/quad/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.12],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createRingVisual/quad/setDepth/0","expression":"RING_DEPTH"}},
  {"id":"cpu:effects/GaussRenderer.ts:createVisual/halo/configureAdditiveImage/0","owner":"effects/GaussRenderer.ts","component":"createVisual/halo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14.8],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/halo/configureAdditiveImage/0","expression":"DEPTH_GAUSS_HALO"}},
  {"id":"cpu:effects/GaussRenderer.ts:createVisual/core/configureAdditiveImage/0","owner":"effects/GaussRenderer.ts","component":"createVisual/core/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/core/configureAdditiveImage/0","expression":"DEPTH_GAUSS_CORE"}},
  {"id":"cpu:effects/GaussRenderer.ts:createVisual/arcEmitter/createEmitter/0","owner":"effects/GaussRenderer.ts","component":"createVisual/arcEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.3],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/arcEmitter/createEmitter/0","expression":"DEPTH_GAUSS_ARC"}},
  {"id":"cpu:effects/GrenadeRenderer.ts:createVisual/glow/configureAdditiveImage/0","owner":"effects/GrenadeRenderer.ts","component":"createVisual/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createVisual/glow/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES - 1"}},
  {"id":"cpu:effects/GrenadeRenderer.ts:createVisual/body/setDepth/0","owner":"effects/GrenadeRenderer.ts","component":"createVisual/body/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/body/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:effects/GrenadeRenderer.ts:createVisual/detail/setDepth/0","owner":"effects/GrenadeRenderer.ts","component":"createVisual/detail/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.2],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/detail/setDepth/0","expression":"DEPTH.PROJECTILES + 0.2"}},
  {"id":"cpu:effects/GrenadeRenderer.ts:createVisual/trail/createEmitter/0","owner":"effects/GrenadeRenderer.ts","component":"createVisual/trail/createEmitter/0","height":"body","lighting":"mixed","camera":"world","depths":[14.8],"blends":["ADD","NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/trail/createEmitter/0","expression":"DEPTH.PROJECTILES - 0.2"}},
  {"id":"cpu:effects/GrenadeRenderer.ts:spawnFirePuff/puff/setDepth/0","owner":"effects/GrenadeRenderer.ts","component":"spawnFirePuff/puff/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.7,16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"spawnFirePuff/puff/setDepth/0","expression":"isVoid ? DEPTH.PROJECTILES - 0.3 : DEPTH.FIRE"}},
  {"id":"cpu:effects/GroundHazardWarningRenderer.ts:sync/image/setDepth/0","owner":"effects/GroundHazardWarningRenderer.ts","component":"sync/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.9],"blends":["ADD"],"profiles":["L"],"role":"ui","source":{"selector":"sync/image/setDepth/0","expression":"DEPTH.FIRE - 0.1"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:createVisual/halo/configureAdditiveImage/0","owner":"effects/GuardianSpiritRenderer.ts","component":"createVisual/halo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.32],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/halo/configureAdditiveImage/0","expression":"SPIRIT_DEPTH - 0.03"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:createVisual/core/configureAdditiveImage/0","owner":"effects/GuardianSpiritRenderer.ts","component":"createVisual/core/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.38],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/core/configureAdditiveImage/0","expression":"SPIRIT_DEPTH + 0.03"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:createVisual/wingLeft/configureAdditiveImage/0","owner":"effects/GuardianSpiritRenderer.ts","component":"createVisual/wingLeft/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.35],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/wingLeft/configureAdditiveImage/0","expression":"SPIRIT_DEPTH"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:createVisual/wingRight/configureAdditiveImage/0","owner":"effects/GuardianSpiritRenderer.ts","component":"createVisual/wingRight/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.35],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/wingRight/configureAdditiveImage/0","expression":"SPIRIT_DEPTH"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:createVisual/trail/createEmitter/0","owner":"effects/GuardianSpiritRenderer.ts","component":"createVisual/trail/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.27],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/trail/createEmitter/0","expression":"SPIRIT_DEPTH - 0.08"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:createVisual/motes/createEmitter/0","owner":"effects/GuardianSpiritRenderer.ts","component":"createVisual/motes/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.3],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/motes/createEmitter/0","expression":"SPIRIT_DEPTH - 0.05"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:playImpact/ring/configureAdditiveImage/0","owner":"effects/GuardianSpiritRenderer.ts","component":"playImpact/ring/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.45],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/ring/configureAdditiveImage/0","expression":"SPIRIT_DEPTH + 0.1"}},
  {"id":"cpu:effects/GuardianSpiritRenderer.ts:playBurst/emitter/createEmitter/0","owner":"effects/GuardianSpiritRenderer.ts","component":"playBurst/emitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.47],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playBurst/emitter/createEmitter/0","expression":"SPIRIT_DEPTH + 0.12"}},
  {"id":"cpu:effects/HealingAuraRenderer.ts:syncAura/field/configureAdditiveImage/0","owner":"effects/HealingAuraRenderer.ts","component":"syncAura/field/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[9.82],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"syncAura/field/configureAdditiveImage/0","expression":"DEPTH.PLAYERS - 0.18"}},
  {"id":"cpu:effects/HealingAuraRenderer.ts:syncAura/ring/setDepth/0","owner":"effects/HealingAuraRenderer.ts","component":"syncAura/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.83],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"syncAura/ring/setDepth/0","expression":"DEPTH.PLAYERS - 0.17"}},
  {"id":"cpu:effects/HealingAuraRenderer.ts:spawnHealingBurst/particle/configureAdditiveImage/0","owner":"effects/HealingAuraRenderer.ts","component":"spawnHealingBurst/particle/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[10.3],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"spawnHealingBurst/particle/configureAdditiveImage/0","expression":"DEPTH.PLAYERS + 0.3"}},
  {"id":"cpu:effects/HitFeedbackRenderer.ts:syncSlot/slot.image/setDepth/0","owner":"effects/HitFeedbackRenderer.ts","component":"syncSlot/slot.image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.97,10.02],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"syncSlot/slot.image/setDepth/0","expression":"sprite.depth + DEPTH_OFFSET"}},
  {"id":"cpu:effects/HolyExplosionRenderer.ts:spawnEmblem/layers/depth/0","owner":"effects/HolyExplosionRenderer.ts","component":"spawnEmblem/layers/depth/0","height":"body","lighting":"material","camera":"world","depths":[25.42],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"spawnEmblem/layers/depth/0","expression":"DEPTH_FX + 0.42"}},
  {"id":"cpu:effects/HolyExplosionRenderer.ts:spawnEmblem/layers/depth/1","owner":"effects/HolyExplosionRenderer.ts","component":"spawnEmblem/layers/depth/1","height":"body","lighting":"material","camera":"world","depths":[25.44],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"spawnEmblem/layers/depth/1","expression":"DEPTH_FX + 0.44"}},
  {"id":"cpu:effects/HolyExplosionRenderer.ts:spawnEmblem/layers/depth/2","owner":"effects/HolyExplosionRenderer.ts","component":"spawnEmblem/layers/depth/2","height":"body","lighting":"material","camera":"world","depths":[25.46],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"spawnEmblem/layers/depth/2","expression":"DEPTH_FX + 0.46"}},
  {"id":"cpu:effects/HolyExplosionRenderer.ts:image/image/setDepth/0","owner":"effects/HolyExplosionRenderer.ts","component":"image/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25.2,25.42,25.44,25.46,25.5],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"image/image/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/HolyGrenadeRenderer.ts:createVisual/glow/setDepth/0","owner":"effects/HolyGrenadeRenderer.ts","component":"createVisual/glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createVisual/glow/setDepth/0","expression":"DEPTH.PROJECTILES - 1"}},
  {"id":"cpu:effects/HolyGrenadeRenderer.ts:createVisual/body/setDepth/0","owner":"effects/HolyGrenadeRenderer.ts","component":"createVisual/body/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/body/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:effects/HolyGrenadeRenderer.ts:createVisual/trim/setDepth/0","owner":"effects/HolyGrenadeRenderer.ts","component":"createVisual/trim/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.2],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/trim/setDepth/0","expression":"DEPTH.PROJECTILES + 0.2"}},
  {"id":"cpu:effects/HolyGrenadeRenderer.ts:createVisual/pin/setDepth/0","owner":"effects/HolyGrenadeRenderer.ts","component":"createVisual/pin/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.3],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/pin/setDepth/0","expression":"DEPTH.PROJECTILES + 0.3"}},
  {"id":"cpu:effects/HolyGrenadeRenderer.ts:createVisual/sparkEmitter/setDepth/0","owner":"effects/HolyGrenadeRenderer.ts","component":"createVisual/sparkEmitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[14.6],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/sparkEmitter/setDepth/0","expression":"DEPTH.PROJECTILES - 0.4"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:module/this.outerAura/setDepth/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"module/this.outerAura/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.05],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.outerAura/setDepth/0","expression":"DEPTH_RAGE_AURA_OUTER"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:module/this.coreAura/setDepth/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"module/this.coreAura/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.07],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.coreAura/setDepth/0","expression":"DEPTH_RAGE_AURA_CORE"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:module/this.ringAura/setDepth/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"module/this.ringAura/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.08],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.ringAura/setDepth/0","expression":"DEPTH_RAGE_AURA_CORE + 0.01"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:module/this.bloodEmitter/createEmitter/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"module/this.bloodEmitter/createEmitter/0","height":"body","lighting":"material","camera":"world","depths":[10.11],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.bloodEmitter/createEmitter/0","expression":"DEPTH_RAGE_BLOOD"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:playBloodBurst/streak/setDepth/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"playBloodBurst/streak/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.15],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"playBloodBurst/streak/setDepth/0","expression":"DEPTH_RAGE_SPLASH"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:playBloodBurst/depth/depth/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"playBloodBurst/depth/depth/0","height":"body","lighting":"material","camera":"world","depths":[9.95],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"playBloodBurst/depth/depth/0","expression":"DEPTH_RAGE_STAIN"}},
  {"id":"cpu:effects/HoneyBadgerRageRenderer.ts:playBloodBurst/droplet/setDepth/0","owner":"effects/HoneyBadgerRageRenderer.ts","component":"playBloodBurst/droplet/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.16],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"playBloodBurst/droplet/setDepth/0","expression":"DEPTH_RAGE_SPLASH + 0.01"}},
  {"id":"cpu:effects/HydraRenderer.ts:createVisual/glow/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"createVisual/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14.75],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glow/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES - 0.25"}},
  {"id":"cpu:effects/HydraRenderer.ts:createVisual/membrane/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"createVisual/membrane/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.7],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/membrane/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.7"}},
  {"id":"cpu:effects/HydraRenderer.ts:createVisual/cluster/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"createVisual/cluster/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.55],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/cluster/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.55"}},
  {"id":"cpu:effects/HydraRenderer.ts:createVisual/coreEmitter/createEmitter/0","owner":"effects/HydraRenderer.ts","component":"createVisual/coreEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/coreEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 1.1"}},
  {"id":"cpu:effects/HydraRenderer.ts:createVisual/shellEmitter/createEmitter/0","owner":"effects/HydraRenderer.ts","component":"createVisual/shellEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.85],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/shellEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 0.85"}},
  {"id":"cpu:effects/HydraRenderer.ts:createVisual/moteEmitter/createEmitter/0","owner":"effects/HydraRenderer.ts","component":"createVisual/moteEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.95],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/moteEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 0.95"}},
  {"id":"cpu:effects/HydraRenderer.ts:playImpact/glow/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"playImpact/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.4],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/glow/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.4"}},
  {"id":"cpu:effects/HydraRenderer.ts:playImpact/cluster/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"playImpact/cluster/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.52],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/cluster/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.52"}},
  {"id":"cpu:effects/HydraRenderer.ts:playImpact/membrane/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"playImpact/membrane/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.6],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/membrane/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.6"}},
  {"id":"cpu:effects/HydraRenderer.ts:playImpact/burst/createEmitter/0","owner":"effects/HydraRenderer.ts","component":"playImpact/burst/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.75],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/burst/createEmitter/0","expression":"DEPTH.PROJECTILES + 1.75"}},
  {"id":"cpu:effects/HydraRenderer.ts:playSplitImpact/pulse/configureAdditiveImage/0","owner":"effects/HydraRenderer.ts","component":"playSplitImpact/pulse/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.5],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playSplitImpact/pulse/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.5"}},
  {"id":"cpu:effects/HydraRenderer.ts:playSplitImpact/emitter/createEmitter/0","owner":"effects/HydraRenderer.ts","component":"playSplitImpact/emitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.85],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playSplitImpact/emitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 1.85"}},
  {"id":"cpu:effects/HydraRenderer.ts:playSplitImpact/wisp/setDepth/0","owner":"effects/HydraRenderer.ts","component":"playSplitImpact/wisp/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.9],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playSplitImpact/wisp/setDepth/0","expression":"DEPTH.PROJECTILES + 0.9"}},
  {"id":"cpu:effects/LightingSystem.ts:syncLightBleed/quad/setDepth/0","owner":"effects/LightingSystem.ts","component":"syncLightBleed/quad/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.501],"blends":["SCREEN"],"profiles":["E","L"],"role":"pass","source":{"selector":"syncLightBleed/quad/setDepth/0","expression":"DEPTH_LIGHTING + 0.001"}},
  {"id":"cpu:effects/LightingSystem.ts:ensureLightMap/lightMap/setDepth/0","owner":"effects/LightingSystem.ts","component":"ensureLightMap/lightMap/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[19.5],"blends":["MULTIPLY"],"profiles":["E","L"],"role":"pass","source":{"selector":"ensureLightMap/lightMap/setDepth/0","expression":"DEPTH_LIGHTING"}},
  {"id":"cpu:effects/LightingSystem.ts:createOccluderSlot/renderTexture/setDepth/0","owner":"effects/LightingSystem.ts","component":"createOccluderSlot/renderTexture/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[19.49,19.491,19.492,19.493],"blends":["NORMAL"],"profiles":["L"],"role":"pass","source":{"selector":"createOccluderSlot/renderTexture/setDepth/0","expression":"DEPTH_LIGHTING - 0.01 + slotIndex * 0.001"}},
  {"id":"cpu:effects/LowHealthBloodOverlay.ts:ensureObjects/createLayer/setDepth/0","owner":"effects/LowHealthBloodOverlay.ts","component":"ensureObjects/createLayer/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[98],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"ensureObjects/createLayer/setDepth/0","expression":"DEPTH_LOW_HEALTH_BLOOD"}},
  {"id":"cpu:effects/MeteorRenderer.ts:createWarningVisual/warningCircle/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"createWarningVisual/warningCircle/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.5],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createWarningVisual/warningCircle/setDepth/0","expression":"DEPTH_WARNING"}},
  {"id":"cpu:effects/MeteorRenderer.ts:createWarningVisual/warningFill/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"createWarningVisual/warningFill/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.49],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createWarningVisual/warningFill/setDepth/0","expression":"DEPTH_WARNING - 0.01"}},
  {"id":"cpu:effects/MeteorRenderer.ts:createWarningVisual/shadow/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"createWarningVisual/shadow/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[15.48],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createWarningVisual/shadow/setDepth/0","expression":"DEPTH_WARNING - 0.02"}},
  {"id":"cpu:effects/MeteorRenderer.ts:createWarningVisual/meteorGlow/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"createWarningVisual/meteorGlow/setDepth/0","height":"high","lighting":"emissive","camera":"world","depths":[16.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createWarningVisual/meteorGlow/setDepth/0","expression":"DEPTH_METEOR"}},
  {"id":"cpu:effects/MeteorRenderer.ts:createWarningVisual/trailEmitter/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"createWarningVisual/trailEmitter/setDepth/0","height":"high","lighting":"material","camera":"world","depths":[16.25],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createWarningVisual/trailEmitter/setDepth/0","expression":"DEPTH_METEOR + 0.05"}},
  {"id":"cpu:effects/MeteorRenderer.ts:playImpactEffect/flash/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"playImpactEffect/flash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playImpactEffect/flash/setDepth/0","expression":"DEPTH_IMPACT + 1"}},
  {"id":"cpu:effects/MeteorRenderer.ts:playImpactEffect/blast/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"playImpactEffect/blast/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playImpactEffect/blast/setDepth/0","expression":"DEPTH_IMPACT"}},
  {"id":"cpu:effects/MeteorRenderer.ts:playImpactEffect/ring/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"playImpactEffect/ring/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playImpactEffect/ring/setDepth/0","expression":"DEPTH_IMPACT"}},
  {"id":"cpu:effects/MeteorRenderer.ts:playImpactEffect/sparkEmitter/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"playImpactEffect/sparkEmitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.1],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playImpactEffect/sparkEmitter/setDepth/0","expression":"DEPTH_IMPACT + 0.1"}},
  {"id":"cpu:effects/MeteorRenderer.ts:playImpactEffect/emberEmitter/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"playImpactEffect/emberEmitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playImpactEffect/emberEmitter/setDepth/0","expression":"DEPTH_IMPACT"}},
  {"id":"cpu:effects/MeteorRenderer.ts:playImpactEffect/scorch/setDepth/0","owner":"effects/MeteorRenderer.ts","component":"playImpactEffect/scorch/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[15.4],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactEffect/scorch/setDepth/0","expression":"DEPTH_WARNING - 0.1"}},
  {"id":"cpu:effects/MiniTeslaDomeRenderer.ts:syncDome/visual/depth/0","owner":"effects/MiniTeslaDomeRenderer.ts","component":"syncDome/visual/depth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.86],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"syncDome/visual/depth/0","expression":"DEPTH.PLAYERS - 0.14"}},
  {"id":"cpu:effects/MiniTeslaDomeRenderer.ts:syncDome/visual/boltDepth/0","owner":"effects/MiniTeslaDomeRenderer.ts","component":"syncDome/visual/boltDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"syncDome/visual/boltDepth/0","expression":"DEPTH.PLAYERS + 0.12"}},
  {"id":"cpu:effects/MolotovFirewalkerRenderer.ts:module/this.glow/configureAdditiveImage/0","owner":"effects/MolotovFirewalkerRenderer.ts","component":"module/this.glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[9.98],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.glow/configureAdditiveImage/0","expression":"DEPTH.PLAYERS - 0.02"}},
  {"id":"cpu:effects/MolotovFirewalkerRenderer.ts:module/this.sparks/createEmitter/0","owner":"effects/MolotovFirewalkerRenderer.ts","component":"module/this.sparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[10.12],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.sparks/createEmitter/0","expression":"DEPTH.PLAYERS + 0.12"}},
  {"id":"cpu:effects/PlasmaBurnerChargeRenderer.ts:createVisual/make/configureAdditiveImage/0","owner":"effects/PlasmaBurnerChargeRenderer.ts","component":"createVisual/make/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/make/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.1"}},
  {"id":"cpu:effects/PlasmaBurnerRenderer.ts:createBeamQuad/quad/setDepth/0","owner":"effects/PlasmaBurnerRenderer.ts","component":"createBeamQuad/quad/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.16],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createBeamQuad/quad/setDepth/0","expression":"DEPTH_TRACE + 0.16"}},
  {"id":"cpu:effects/PlasmaChargeRenderer.ts:module/this.coreEmitter/setDepth/0","owner":"effects/PlasmaChargeRenderer.ts","component":"module/this.coreEmitter/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.24],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.coreEmitter/setDepth/0","expression":"CHARGE_CORE_DEPTH"}},
  {"id":"cpu:effects/PlasmaChargeRenderer.ts:module/this.sparkEmitter/setDepth/0","owner":"effects/PlasmaChargeRenderer.ts","component":"module/this.sparkEmitter/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.3],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.sparkEmitter/setDepth/0","expression":"CHARGE_SPARK_DEPTH"}},
  {"id":"cpu:effects/PlasmaChargeRenderer.ts:module/this.glowImage/setDepth/0","owner":"effects/PlasmaChargeRenderer.ts","component":"module/this.glowImage/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.16],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.glowImage/setDepth/0","expression":"CHARGE_GLOW_DEPTH"}},
  {"id":"cpu:effects/PressureShieldRenderer.ts:module/this.shell/configureAdditiveImage/0","owner":"effects/PressureShieldRenderer.ts","component":"module/this.shell/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[10.18],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.shell/configureAdditiveImage/0","expression":"DEPTH.PLAYERS + 0.18"}},
  {"id":"cpu:effects/PressureShieldRenderer.ts:module/this.echo/configureAdditiveImage/0","owner":"effects/PressureShieldRenderer.ts","component":"module/this.echo/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[10.19],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.echo/configureAdditiveImage/0","expression":"DEPTH.PLAYERS + 0.19"}},
  {"id":"cpu:effects/ProjectileBurnRenderer.ts:sync/glow/setDepth/0","owner":"effects/ProjectileBurnRenderer.ts","component":"sync/glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.28],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"sync/glow/setDepth/0","expression":"DEPTH.PROJECTILES + 0.28"}},
  {"id":"cpu:effects/ReinforcementMatrixRenderer.ts:createVisual/carpet/setDepth/0","owner":"effects/ReinforcementMatrixRenderer.ts","component":"createVisual/carpet/setDepth/0","height":"ground","lighting":"emissive","camera":"world","depths":[5.4],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/carpet/setDepth/0","expression":"DEPTH.DECALS + 0.4"}},
  {"id":"cpu:effects/ReinforcementMatrixRenderer.ts:createVisual/ring/setDepth/0","owner":"effects/ReinforcementMatrixRenderer.ts","component":"createVisual/ring/setDepth/0","height":"ground","lighting":"emissive","camera":"world","depths":[5.45],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/ring/setDepth/0","expression":"DEPTH.DECALS + 0.45"}},
  {"id":"cpu:effects/ReinforcementMatrixRenderer.ts:createVisual/sparks/setDepth/0","owner":"effects/ReinforcementMatrixRenderer.ts","component":"createVisual/sparks/setDepth/0","height":"ground","lighting":"emissive","camera":"world","depths":[5.5],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/sparks/setDepth/0","expression":"DEPTH.DECALS + 0.5"}},
  {"id":"cpu:effects/RemoteControlRenderer.ts:createVisual/halo/setDepth/0","owner":"effects/RemoteControlRenderer.ts","component":"createVisual/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.76],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/halo/setDepth/0","expression":"DEPTH.PROJECTILES - 0.24"}},
  {"id":"cpu:effects/RemoteControlRenderer.ts:createVisual/ring/setDepth/0","owner":"effects/RemoteControlRenderer.ts","component":"createVisual/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.82],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/ring/setDepth/0","expression":"DEPTH.PROJECTILES - 0.18"}},
  {"id":"cpu:effects/RemoteControlRenderer.ts:createVisual/sparks/setDepth/0","owner":"effects/RemoteControlRenderer.ts","component":"createVisual/sparks/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.88],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/sparks/setDepth/0","expression":"DEPTH.PROJECTILES - 0.12"}},
  {"id":"cpu:effects/RepairDroneEffects.ts:module/this.surface/setDepth/0","owner":"effects/RepairDroneEffects.ts","component":"module/this.surface/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.388],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"module/this.surface/setDepth/0","expression":"REPAIR_DRONE_DEPTH - 0.012"}},
  {"id":"cpu:effects/RepairDroneEffects.ts:module/this.light/setDepth/0","owner":"effects/RepairDroneEffects.ts","component":"module/this.light/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.412],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"module/this.light/setDepth/0","expression":"REPAIR_DRONE_DEPTH + 0.012"}},
  {"id":"cpu:effects/RockDestructionRenderer.ts:activateFragment/image/setDepth/0","owner":"effects/RockDestructionRenderer.ts","component":"activateFragment/image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.85],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"activateFragment/image/setDepth/0","expression":"DEPTH_TRACE - 0.15"}},
  {"id":"cpu:effects/RockDestructionRenderer.ts:ensureSharedEmitters/this.sharedDustEmitter/createEmitter/0","owner":"effects/RockDestructionRenderer.ts","component":"ensureSharedEmitters/this.sharedDustEmitter/createEmitter/0","height":"body","lighting":"material","camera":"world","depths":[15.7],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"ensureSharedEmitters/this.sharedDustEmitter/createEmitter/0","expression":"DEPTH_TRACE - 0.3"}},
  {"id":"cpu:effects/RockDestructionRenderer.ts:ensureSharedEmitters/this.sharedDebrisEmitter/createEmitter/0","owner":"effects/RockDestructionRenderer.ts","component":"ensureSharedEmitters/this.sharedDebrisEmitter/createEmitter/0","height":"body","lighting":"material","camera":"world","depths":[15.75],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"ensureSharedEmitters/this.sharedDebrisEmitter/createEmitter/0","expression":"DEPTH_TRACE - 0.25"}},
  {"id":"cpu:effects/RockDestructionRenderer.ts:prewarmFragmentPool/image/setDepth/0","owner":"effects/RockDestructionRenderer.ts","component":"prewarmFragmentPool/image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.85],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"prewarmFragmentPool/image/setDepth/0","expression":"DEPTH_TRACE - 0.15"}},
  {"id":"cpu:effects/RocketRenderer.ts:createVisual/body/setDepth/0","owner":"effects/RocketRenderer.ts","component":"createVisual/body/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/body/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:effects/RocketRenderer.ts:createVisual/accent/setDepth/0","owner":"effects/RocketRenderer.ts","component":"createVisual/accent/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/accent/setDepth/0","expression":"DEPTH.PROJECTILES + 1"}},
  {"id":"cpu:effects/RocketRenderer.ts:createVisual/glow/setDepth/0","owner":"effects/RocketRenderer.ts","component":"createVisual/glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createVisual/glow/setDepth/0","expression":"DEPTH.PROJECTILES - 1"}},
  {"id":"cpu:effects/RocketRenderer.ts:createVisual/engine/setDepth/0","owner":"effects/RocketRenderer.ts","component":"createVisual/engine/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/engine/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:effects/RocketRenderer.ts:playCollection/ring/setDepth/0","owner":"effects/RocketRenderer.ts","component":"playCollection/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playCollection/ring/setDepth/0","expression":"DEPTH.PROJECTILES + 1"}},
  {"id":"cpu:effects/RocketRenderer.ts:playCollection/burst/setDepth/0","owner":"effects/RocketRenderer.ts","component":"playCollection/burst/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playCollection/burst/setDepth/0","expression":"DEPTH.PROJECTILES + 1"}},
  {"id":"cpu:effects/SharedGlowSystem.ts:createBandBuffer/image/setDepth/0","owner":"effects/SharedGlowSystem.ts","component":"createBandBuffer/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","clarityDepths":[99.5],"depths":[19.99,99.5],"blends":["ADD"],"profiles":["C","E"],"role":"effect","source":{"selector":"createBandBuffer/image/setDepth/0","expression":"cameraMode === 'world' ? DEPTH.CANOPY - 0.01 : DEPTH.OVERLAY - 0.5"}},
  {"id":"cpu:effects/ShootingRangeRenderer.ts:module/this.controlIcons/setDepth/0","owner":"effects/ShootingRangeRenderer.ts","component":"module/this.controlIcons/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.1],"blends":["NORMAL"],"profiles":["M"],"role":"ui","source":{"selector":"module/this.controlIcons/setDepth/0","expression":"DEPTH.ROCKS + 0.1"}},
  {"id":"cpu:effects/ShootingRangeRenderer.ts:module/this.targetGlows/setDepth/0","owner":"effects/ShootingRangeRenderer.ts","component":"module/this.targetGlows/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[5.2],"blends":["NORMAL"],"profiles":["G"],"role":"ui","source":{"selector":"module/this.targetGlows/setDepth/0","expression":"DEPTH.DECALS + 0.2"}},
  {"id":"cpu:effects/ShootingRangeRenderer.ts:module/this.supplyGlows/setDepth/0","owner":"effects/ShootingRangeRenderer.ts","component":"module/this.supplyGlows/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[5.1],"blends":["NORMAL"],"profiles":["G"],"role":"ui","source":{"selector":"module/this.supplyGlows/setDepth/0","expression":"DEPTH.DECALS + 0.1"}},
  {"id":"cpu:effects/ShootingRangeRenderer.ts:module/this.panel/setDepth/0","owner":"effects/ShootingRangeRenderer.ts","component":"module/this.panel/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[22],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.panel/setDepth/0","expression":"DEPTH.LOCAL_UI"}},
  {"id":"cpu:effects/ShootingRangeRenderer.ts:graphics/graphics/setDepth/0","owner":"effects/ShootingRangeRenderer.ts","component":"graphics/graphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[5.1],"blends":["NORMAL"],"profiles":["G"],"role":"ui","source":{"selector":"graphics/graphics/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/SlimeTrailRenderer.ts:playBloomBurst/chunk/setDepth/0","owner":"effects/SlimeTrailRenderer.ts","component":"playBloomBurst/chunk/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.48],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playBloomBurst/chunk/setDepth/0","expression":"DEPTH.PROJECTILES + 0.48"}},
  {"id":"cpu:effects/SlimeTrailRenderer.ts:createBubbleEmitter/createEmitter/createEmitter/0","owner":"effects/SlimeTrailRenderer.ts","component":"createBubbleEmitter/createEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[8.7,15.42],"blends":["ADD"],"profiles":["L","M"],"role":"effect","source":{"selector":"createBubbleEmitter/createEmitter/createEmitter/0","expression":"depth"}},
  {"id":"cpu:effects/SlimeTrailRenderer.ts:createGlintEmitter/createEmitter/createEmitter/0","owner":"effects/SlimeTrailRenderer.ts","component":"createGlintEmitter/createEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[8.71],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createGlintEmitter/createEmitter/createEmitter/0","expression":"SLIME_GROUND_DEPTH + 0.06"}},
  {"id":"cpu:effects/SlimeTrailRenderer.ts:createRippleEmitter/createEmitter/createEmitter/0","owner":"effects/SlimeTrailRenderer.ts","component":"createRippleEmitter/createEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[8.69],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createRippleEmitter/createEmitter/createEmitter/0","expression":"SLIME_GROUND_DEPTH + 0.04"}},
  {"id":"cpu:effects/SlimeTrailRenderer.ts:syncPuddles/image/setDepth/0","owner":"effects/SlimeTrailRenderer.ts","component":"syncPuddles/image/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[8.65],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"syncPuddles/image/setDepth/0","expression":"SLIME_GROUND_DEPTH"}},
  {"id":"cpu:effects/SlimeTrailRenderer.ts:syncAffectedEnemies/visual/configureAdditiveImage/0","owner":"effects/SlimeTrailRenderer.ts","component":"syncAffectedEnemies/visual/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.38],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"syncAffectedEnemies/visual/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.38"}},
  {"id":"cpu:effects/SmokeBodyEffect.ts:module/this.scatter/setDepth/0","owner":"effects/SmokeBodyEffect.ts","component":"module/this.scatter/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[18.05],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"module/this.scatter/setDepth/0","expression":"DEPTH.SMOKE + .05"}},
  {"id":"cpu:effects/SmokeBodyEffect.ts:update/wisp/setDepth/0","owner":"effects/SmokeBodyEffect.ts","component":"update/wisp/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.22,10.27],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"update/wisp/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/SmokeBodyEffect.ts:update/this.arcs/setDepth/0","owner":"effects/SmokeBodyEffect.ts","component":"update/this.arcs/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.23,10.28],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"update/this.arcs/setDepth/0","expression":"depth + .01"}},
  {"id":"cpu:effects/SmokeSystem.ts:renderFrame/this.surface/setDepth/0","owner":"effects/SmokeSystem.ts","component":"renderFrame/this.surface/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[18],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"renderFrame/this.surface/setDepth/0","expression":"DEPTH.SMOKE"}},
  {"id":"cpu:effects/SmokeSystem.ts:updateStatusEffects/ring/setDepth/0","owner":"effects/SmokeSystem.ts","component":"updateStatusEffects/ring/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[18.3],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"updateStatusEffects/ring/setDepth/0","expression":"DEPTH.SMOKE + 0.3"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playAfterglow/glow/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playAfterglow/glow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[24.3],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playAfterglow/glow/setDepth/0","expression":"DEPTH_FX - 0.7"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playEnemyCoreBurst/core/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playEnemyCoreBurst/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playEnemyCoreBurst/core/setDepth/0","expression":"DEPTH_FX + 1"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playEnemyParticleBurst/emitter/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playEnemyParticleBurst/emitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.5],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playEnemyParticleBurst/emitter/setDepth/0","expression":"DEPTH_FX + 0.5"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playCoreBurst/core/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playCoreBurst/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26.5],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playCoreBurst/core/setDepth/0","expression":"DEPTH_FX + 1.5"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playCoreBurst/halo/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playCoreBurst/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[26],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playCoreBurst/halo/setDepth/0","expression":"DEPTH_FX + 1"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:spawnRing/ring/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"spawnRing/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"spawnRing/ring/setDepth/0","expression":"DEPTH_FX"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playBeam/beam/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playBeam/beam/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[24.5],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playBeam/beam/setDepth/0","expression":"DEPTH_FX - 0.5"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playBeam/beamGlow/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playBeam/beamGlow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[24.4],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"playBeam/beamGlow/setDepth/0","expression":"DEPTH_FX - 0.6"}},
  {"id":"cpu:effects/SpawnEffectRenderer.ts:playParticleBurst/emitter/setDepth/0","owner":"effects/SpawnEffectRenderer.ts","component":"playParticleBurst/emitter/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[25.5],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"playParticleBurst/emitter/setDepth/0","expression":"DEPTH_FX + 0.5"}},
  {"id":"cpu:effects/SporeRenderer.ts:createVisual/glow/configureAdditiveImage/0","owner":"effects/SporeRenderer.ts","component":"createVisual/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[14.8],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glow/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES - 0.2"}},
  {"id":"cpu:effects/SporeRenderer.ts:createVisual/cluster/configureAdditiveImage/0","owner":"effects/SporeRenderer.ts","component":"createVisual/cluster/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.5],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/cluster/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.5"}},
  {"id":"cpu:effects/SporeRenderer.ts:createVisual/coreEmitter/createEmitter/0","owner":"effects/SporeRenderer.ts","component":"createVisual/coreEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/coreEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 1"}},
  {"id":"cpu:effects/SporeRenderer.ts:createVisual/wakeEmitter/createEmitter/0","owner":"effects/SporeRenderer.ts","component":"createVisual/wakeEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/wakeEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 0.2"}},
  {"id":"cpu:effects/SporeRenderer.ts:playImpact/glow/configureAdditiveImage/0","owner":"effects/SporeRenderer.ts","component":"playImpact/glow/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.3],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/glow/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.3"}},
  {"id":"cpu:effects/SporeRenderer.ts:playImpact/cluster/configureAdditiveImage/0","owner":"effects/SporeRenderer.ts","component":"playImpact/cluster/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[16.5],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/cluster/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 1.5"}},
  {"id":"cpu:effects/SporeRenderer.ts:playImpact/burst/createEmitter/0","owner":"effects/SporeRenderer.ts","component":"playImpact/burst/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.7],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/burst/createEmitter/0","expression":"DEPTH.PROJECTILES + 1.7"}},
  {"id":"cpu:effects/SporeRenderer.ts:playImpact/haze/createEmitter/0","owner":"effects/SporeRenderer.ts","component":"playImpact/haze/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/haze/createEmitter/0","expression":"DEPTH.FIRE + 0.2"}},
  {"id":"cpu:effects/SporeRenderer.ts:spawnTrailPuff/puff/setDepth/0","owner":"effects/SporeRenderer.ts","component":"spawnTrailPuff/puff/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[14.7],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"spawnTrailPuff/puff/setDepth/0","expression":"DEPTH.PROJECTILES - 0.3"}},
  {"id":"cpu:effects/StinkCloudBody.ts:module/this.quad/setDepth/0","owner":"effects/StinkCloudBody.ts","component":"module/this.quad/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[17],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"module/this.quad/setDepth/0","expression":"DEPTH.STINK"}},
  {"id":"cpu:effects/StinkCloudSystem.ts:createVisual/groundGlow/setDepth/0","owner":"effects/StinkCloudSystem.ts","component":"createVisual/groundGlow/setDepth/0","height":"ground","lighting":"mixed","camera":"world","depths":[16.88],"blends":["ADD","MULTIPLY"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/groundGlow/setDepth/0","expression":"STINK_DEPTH - 0.12"}},
  {"id":"cpu:effects/StinkCloudSystem.ts:createVisual/damageAura/setDepth/0","owner":"effects/StinkCloudSystem.ts","component":"createVisual/damageAura/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.92],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/damageAura/setDepth/0","expression":"STINK_DEPTH - 0.08"}},
  {"id":"cpu:effects/StinkCloudSystem.ts:createVisual/reactionPulse/setDepth/0","owner":"effects/StinkCloudSystem.ts","component":"createVisual/reactionPulse/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.96],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/reactionPulse/setDepth/0","expression":"STINK_DEPTH - 0.04"}},
  {"id":"cpu:effects/StinkCloudSystem.ts:createVisual/electricArcs/setDepth/0","owner":"effects/StinkCloudSystem.ts","component":"createVisual/electricArcs/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[17.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/electricArcs/setDepth/0","expression":"STINK_DEPTH + 0.1"}},
  {"id":"cpu:effects/StinkPlagueRenderer.ts:update/body.image/setDepth/0","owner":"effects/StinkPlagueRenderer.ts","component":"update/body.image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.17,10.22],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"update/body.image/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/StinkPlagueRenderer.ts:update/wisp/setDepth/0","owner":"effects/StinkPlagueRenderer.ts","component":"update/wisp/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.18,10.23],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"update/wisp/setDepth/0","expression":"depth + .01"}},
  {"id":"cpu:effects/StinkPlagueRenderer.ts:update/image/setDepth/0","owner":"effects/StinkPlagueRenderer.ts","component":"update/image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[17.89],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"update/image/setDepth/0","expression":"DEPTH.SMOKE - .11"}},
  {"id":"cpu:effects/TeslaBoltRenderer.ts:createVisual/halos/configureAdditiveImage/0","owner":"effects/TeslaBoltRenderer.ts","component":"createVisual/halos/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/halos/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.1"}},
  {"id":"cpu:effects/TeslaBoltRenderer.ts:createVisual/sparks/configureAdditiveImage/0","owner":"effects/TeslaBoltRenderer.ts","component":"createVisual/sparks/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.22],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/sparks/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.22"}},
  {"id":"cpu:effects/TeslaBoltRenderer.ts:createVisual/arcs/setDepth/0","owner":"effects/TeslaBoltRenderer.ts","component":"createVisual/arcs/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[15.2],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/arcs/setDepth/0","expression":"DEPTH.PROJECTILES + 0.2"}},
  {"id":"cpu:effects/TeslaBoltRenderer.ts:playImpact/flash/configureAdditiveImage/0","owner":"effects/TeslaBoltRenderer.ts","component":"playImpact/flash/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.3],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpact/flash/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.3"}},
  {"id":"cpu:effects/TeslaBoltRenderer.ts:ensureImpactEmitter/this.impactEmitter/createEmitter/0","owner":"effects/TeslaBoltRenderer.ts","component":"ensureImpactEmitter/this.impactEmitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[15.31],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"ensureImpactEmitter/this.impactEmitter/createEmitter/0","expression":"DEPTH.PROJECTILES + 0.31"}},
  {"id":"cpu:effects/TeslaDomeRenderer.ts:createVisual/depth/depth/0","owner":"effects/TeslaDomeRenderer.ts","component":"createVisual/depth/depth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.05],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/depth/depth/0","expression":"DEPTH.FIRE + 0.05"}},
  {"id":"cpu:effects/TeslaDomeRenderer.ts:createVisual/boltDepth/boltDepth/0","owner":"effects/TeslaDomeRenderer.ts","component":"createVisual/boltDepth/boltDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.2],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/boltDepth/boltDepth/0","expression":"DEPTH.FIRE + 0.2"}},
  {"id":"cpu:effects/TeslaFieldVisual.ts:createDomeQuad/quad/setDepth/0","owner":"effects/TeslaFieldVisual.ts","component":"createDomeQuad/quad/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.86,16.05],"blends":["NORMAL"],"profiles":["K","L"],"role":"effect","source":{"selector":"createDomeQuad/quad/setDepth/0","expression":"this.options.depth"}},
  {"id":"cpu:effects/TeslaFieldVisual.ts:createBoltSlot/quad/setDepth/0","owner":"effects/TeslaFieldVisual.ts","component":"createBoltSlot/quad/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.12,16.2],"blends":["NORMAL"],"profiles":["K","L"],"role":"effect","source":{"selector":"createBoltSlot/quad/setDepth/0","expression":"this.options.boltDepth"}},
  {"id":"cpu:effects/TeslaNovaRenderer.ts:createQuad/quad/setDepth/0","owner":"effects/TeslaNovaRenderer.ts","component":"createQuad/quad/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.26],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createQuad/quad/setDepth/0","expression":"DEPTH.FIRE + 0.26"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:createVisual/membrane/setDepth/0","owner":"effects/TimeBubbleRenderer.ts","component":"createVisual/membrane/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.42],"blends":["SCREEN"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/membrane/setDepth/0","expression":"DEPTH.FIRE + 0.42"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:createVisual/interferenceA/setDepth/0","owner":"effects/TimeBubbleRenderer.ts","component":"createVisual/interferenceA/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.48],"blends":["SCREEN"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/interferenceA/setDepth/0","expression":"DEPTH.FIRE + 0.48"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:createVisual/interferenceB/setDepth/0","owner":"effects/TimeBubbleRenderer.ts","component":"createVisual/interferenceB/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.5],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/interferenceB/setDepth/0","expression":"DEPTH.FIRE + 0.5"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:updatePrismCenter/visual.prismHalo/setDepth/0","owner":"effects/TimeBubbleRenderer.ts","component":"updatePrismCenter/visual.prismHalo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.7],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"updatePrismCenter/visual.prismHalo/setDepth/0","expression":"DEPTH.PROJECTILES - 0.3"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:updatePrismCenter/visual.prismCore/setDepth/0","owner":"effects/TimeBubbleRenderer.ts","component":"updatePrismCenter/visual.prismCore/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[14.9],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"updatePrismCenter/visual.prismCore/setDepth/0","expression":"DEPTH.PROJECTILES - 0.1"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:updateResonance/this.scene.add/setDepth/0","owner":"effects/TimeBubbleRenderer.ts","component":"updateResonance/this.scene.add/setDepth/0","height":"body","lighting":"mixed","camera":"world","depths":[16.52,16.53,16.54],"blends":["ADD","NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"updateResonance/this.scene.add/setDepth/0","expression":"DEPTH.FIRE + 0.52 + i * 0.01"}},
  {"id":"cpu:effects/TimeBubbleRenderer.ts:updateResonance/visual.chargeSparks/createEmitter/0","owner":"effects/TimeBubbleRenderer.ts","component":"updateResonance/visual.chargeSparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.56],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"updateResonance/visual.chargeSparks/createEmitter/0","expression":"DEPTH.FIRE + 0.56"}},
  {"id":"cpu:effects/TimebombFuseRenderer.ts:module/this.ring/setDepth/0","owner":"effects/TimebombFuseRenderer.ts","component":"module/this.ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.96],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.ring/setDepth/0","expression":"DEPTH.PLAYERS - 0.04"}},
  {"id":"cpu:effects/TimebombFuseRenderer.ts:module/this.sparks/setDepth/0","owner":"effects/TimebombFuseRenderer.ts","component":"module/this.sparks/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.08],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.sparks/setDepth/0","expression":"DEPTH.PLAYERS + 0.08"}},
  {"id":"cpu:effects/TimebombFuseRenderer.ts:emitCountdownText/label/setDepth/0","owner":"effects/TimebombFuseRenderer.ts","component":"emitCountdownText/label/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"emitCountdownText/label/setDepth/0","expression":"DEPTH.PLAYERS + 2"}},
  {"id":"cpu:effects/TracerBounceDebugOverlay.ts:draw/this.graphics/setDepth/0","owner":"effects/TracerBounceDebugOverlay.ts","component":"draw/this.graphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"draw/this.graphics/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:effects/TranslocatorPuckRenderer.ts:createVisual/baseImage/setDepth/0","owner":"effects/TranslocatorPuckRenderer.ts","component":"createVisual/baseImage/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/baseImage/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:effects/TranslocatorPuckRenderer.ts:createVisual/glowImage/configureAdditiveImage/0","owner":"effects/TranslocatorPuckRenderer.ts","component":"createVisual/glowImage/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[15.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/glowImage/configureAdditiveImage/0","expression":"DEPTH.PROJECTILES + 0.1"}},
  {"id":"cpu:effects/TranslocatorTeleportRenderer.ts:syncPortals/graphics/setDepth/0","owner":"effects/TranslocatorTeleportRenderer.ts","component":"syncPortals/graphics/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[24.8],"blends":["NORMAL"],"profiles":["H"],"role":"effect","source":{"selector":"syncPortals/graphics/setDepth/0","expression":"DEPTH_FX - 0.2"}},
  {"id":"cpu:effects/TranslocatorTeleportRenderer.ts:animate/g/setDepth/0","owner":"effects/TranslocatorTeleportRenderer.ts","component":"animate/g/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[25],"blends":["ADD"],"profiles":["H"],"role":"effect","source":{"selector":"animate/g/setDepth/0","expression":"DEPTH_FX"}},
  {"id":"cpu:effects/WorldInteractionRenderer.ts:sync/this.marker/setDepth/0","owner":"effects/WorldInteractionRenderer.ts","component":"sync/this.marker/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[22],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"sync/this.marker/setDepth/0","expression":"DEPTH.LOCAL_UI"}},
  {"id":"cpu:effects/WorldInteractionRenderer.ts:sync/this.label/setDepth/0","owner":"effects/WorldInteractionRenderer.ts","component":"sync/this.label/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[23],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"sync/this.label/setDepth/0","expression":"DEPTH.LOCAL_UI + 1"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:syncUpgrades/this.statusLayer/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"syncUpgrades/this.statusLayer/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.3],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"syncUpgrades/this.statusLayer/setDepth/0","expression":"DEPTH_TRACE + 0.3"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playSwing/sector/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playSwing/sector/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[16.04],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"playSwing/sector/setDepth/0","expression":"DEPTH_TRACE + 0.04"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playOriginBurst/halo/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playOriginBurst/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.08],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playOriginBurst/halo/setDepth/0","expression":"DEPTH_TRACE + 0.08"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playOriginBurst/streak/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playOriginBurst/streak/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.09],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playOriginBurst/streak/setDepth/0","expression":"DEPTH_TRACE + 0.09"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playOriginBurst/sparks/createEmitter/0","owner":"effects/ZeusTaserRenderer.ts","component":"playOriginBurst/sparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.1],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playOriginBurst/sparks/createEmitter/0","expression":"DEPTH_TRACE + 0.1"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playVolumeParticles/volume/createEmitter/0","owner":"effects/ZeusTaserRenderer.ts","component":"playVolumeParticles/volume/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.07],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playVolumeParticles/volume/createEmitter/0","expression":"DEPTH_TRACE + 0.07"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playVolumeParticles/rim/createEmitter/0","owner":"effects/ZeusTaserRenderer.ts","component":"playVolumeParticles/rim/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.11],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playVolumeParticles/rim/createEmitter/0","expression":"DEPTH_TRACE + 0.11"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playImpactBurst/chain/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playImpactBurst/chain/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.13],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/chain/setDepth/0","expression":"DEPTH_TRACE + 0.13"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playImpactBurst/halo/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playImpactBurst/halo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.14],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/halo/setDepth/0","expression":"DEPTH_TRACE + 0.14"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playImpactBurst/flash/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playImpactBurst/flash/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.15],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/flash/setDepth/0","expression":"DEPTH_TRACE + 0.15"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playImpactBurst/sparks/createEmitter/0","owner":"effects/ZeusTaserRenderer.ts","component":"playImpactBurst/sparks/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[16.16],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/sparks/createEmitter/0","expression":"DEPTH_TRACE + 0.16"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playImpactBurst/branches/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playImpactBurst/branches/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.15],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playImpactBurst/branches/setDepth/0","expression":"DEPTH_TRACE + 0.15"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playTerminusPulse/pulse/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playTerminusPulse/pulse/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.12],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playTerminusPulse/pulse/setDepth/0","expression":"DEPTH_TRACE + 0.12"}},
  {"id":"cpu:effects/ZeusTaserRenderer.ts:playTerminusPulse/core/setDepth/0","owner":"effects/ZeusTaserRenderer.ts","component":"playTerminusPulse/core/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[16.13],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"playTerminusPulse/core/setDepth/0","expression":"DEPTH_TRACE + 0.13"}},
  {"id":"cpu:effects/earthbreak/EarthbreakFissureGpuLayer.ts:createEarthbreakFissureGpuLayer/image/setDepth/0","owner":"effects/earthbreak/EarthbreakFissureGpuLayer.ts","component":"createEarthbreakFissureGpuLayer/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[],"blends":["ADD"],"profiles":[],"role":"delegate","source":{"selector":"createEarthbreakFissureGpuLayer/image/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/earthbreak/EarthbreakFissureGpuLayer.ts:createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/0","owner":"effects/earthbreak/EarthbreakFissureGpuLayer.ts","component":"createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/0","height":"body","lighting":"material","camera":"world","depths":[5.05],"blends":["NORMAL"],"profiles":["G"],"role":"effect","source":{"selector":"createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/0","expression":"DEPTH.DECALS + 0.05"}},
  {"id":"cpu:effects/earthbreak/EarthbreakFissureGpuLayer.ts:createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/1","owner":"effects/earthbreak/EarthbreakFissureGpuLayer.ts","component":"createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/1","height":"body","lighting":"material","camera":"world","depths":[19.57],"blends":["NORMAL"],"profiles":["E"],"role":"effect","source":{"selector":"createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/1","expression":"DEPTH_LIGHTING + 0.07"}},
  {"id":"cpu:effects/enemyClaw/EnemyClawGpuLayer.ts:createEnemyClawGpuLayer/image/setDepth/0","owner":"effects/enemyClaw/EnemyClawGpuLayer.ts","component":"createEnemyClawGpuLayer/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[],"blends":["ADD"],"profiles":[],"role":"delegate","source":{"selector":"createEnemyClawGpuLayer/image/setDepth/0","expression":"depth"}},
  {"id":"cpu:effects/health/WorldHealthBarRenderer.ts:borrowView/view.background/setDepth/0","owner":"effects/health/WorldHealthBarRenderer.ts","component":"borrowView/view.background/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"borrowView/view.background/setDepth/0","expression":"s.backgroundDepth"}},
  {"id":"cpu:effects/health/WorldHealthBarRenderer.ts:borrowView/view.trail/setDepth/0","owner":"effects/health/WorldHealthBarRenderer.ts","component":"borrowView/view.trail/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"borrowView/view.trail/setDepth/0","expression":"(s.backgroundDepth + s.fillDepth) / 2"}},
  {"id":"cpu:effects/health/WorldHealthBarRenderer.ts:borrowView/view.fill/setDepth/0","owner":"effects/health/WorldHealthBarRenderer.ts","component":"borrowView/view.fill/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"borrowView/view.fill/setDepth/0","expression":"s.fillDepth"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:enemyHealthBarStyle/backgroundDepth/backgroundDepth/0","owner":"effects/health/healthBarStyles.ts","component":"enemyHealthBarStyle/backgroundDepth/backgroundDepth/0","height":"ground","lighting":"material","camera":"world","depths":[18.5],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"enemyHealthBarStyle/backgroundDepth/backgroundDepth/0","expression":"DEPTH.SMOKE + 0.5"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:enemyHealthBarStyle/fillDepth/fillDepth/0","owner":"effects/health/healthBarStyles.ts","component":"enemyHealthBarStyle/fillDepth/fillDepth/0","height":"body","lighting":"material","camera":"world","depths":[18.6],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"enemyHealthBarStyle/fillDepth/fillDepth/0","expression":"DEPTH.SMOKE + 0.6"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:playerHealthBarStyle/backgroundDepth/backgroundDepth/0","owner":"effects/health/healthBarStyles.ts","component":"playerHealthBarStyle/backgroundDepth/backgroundDepth/0","height":"ground","lighting":"material","camera":"world","depths":[11],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"playerHealthBarStyle/backgroundDepth/backgroundDepth/0","expression":"DEPTH.PLAYERS + 1"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:playerHealthBarStyle/fillDepth/fillDepth/0","owner":"effects/health/healthBarStyles.ts","component":"playerHealthBarStyle/fillDepth/fillDepth/0","height":"body","lighting":"material","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"playerHealthBarStyle/fillDepth/fillDepth/0","expression":"DEPTH.PLAYERS + 2"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:baseHealthBarStyle/backgroundDepth/backgroundDepth/0","owner":"effects/health/healthBarStyles.ts","component":"baseHealthBarStyle/backgroundDepth/backgroundDepth/0","height":"ground","lighting":"material","camera":"world","depths":[5.8],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"baseHealthBarStyle/backgroundDepth/backgroundDepth/0","expression":"DEPTH.GROUND_FOG + .5"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:baseHealthBarStyle/fillDepth/fillDepth/0","owner":"effects/health/healthBarStyles.ts","component":"baseHealthBarStyle/fillDepth/fillDepth/0","height":"body","lighting":"material","camera":"world","depths":[6],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"baseHealthBarStyle/fillDepth/fillDepth/0","expression":"DEPTH.GROUND_FOG + .7"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:module/TURRET_HEALTH_BAR_STYLE/backgroundDepth/0","owner":"effects/health/healthBarStyles.ts","component":"module/TURRET_HEALTH_BAR_STYLE/backgroundDepth/0","height":"ground","lighting":"material","camera":"world","depths":[9.35],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/TURRET_HEALTH_BAR_STYLE/backgroundDepth/0","expression":"DEPTH.ROCKS + 0.35"}},
  {"id":"cpu:effects/health/healthBarStyles.ts:module/TURRET_HEALTH_BAR_STYLE/fillDepth/0","owner":"effects/health/healthBarStyles.ts","component":"module/TURRET_HEALTH_BAR_STYLE/fillDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.4],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/TURRET_HEALTH_BAR_STYLE/fillDepth/0","expression":"DEPTH.ROCKS + 0.4"}},
  {"id":"cpu:effects/repairDroneVisuals.ts:createRepairDroneBody/scene.add/setDepth/0","owner":"effects/repairDroneVisuals.ts","component":"createRepairDroneBody/scene.add/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15.4],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createRepairDroneBody/scene.add/setDepth/0","expression":"REPAIR_DRONE_DEPTH"}},
  {"id":"cpu:entities/BaseEntity.ts:createPresentationRepresentation/image/setDepth/0","owner":"entities/BaseEntity.ts","component":"createPresentationRepresentation/image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[7],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createPresentationRepresentation/image/setDepth/0","expression":"DEPTH.BASES + 3"}},
  {"id":"cpu:entities/BaseEntity.ts:createPresentationRepresentation/marker/setDepth/0","owner":"entities/BaseEntity.ts","component":"createPresentationRepresentation/marker/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[6],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createPresentationRepresentation/marker/setDepth/0","expression":"DEPTH.BASES + 2"}},
  {"id":"cpu:entities/BaseEntity.ts:setVulnerable/marker/setDepth/0","owner":"entities/BaseEntity.ts","component":"setVulnerable/marker/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"setVulnerable/marker/setDepth/0","expression":"DEPTH.BASES + 5"}},
  {"id":"cpu:entities/BaseVisuals.ts:createBaseSurfaceImages/scene.add/setDepth/0","owner":"entities/BaseVisuals.ts","component":"createBaseSurfaceImages/scene.add/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[4],"blends":["NORMAL"],"profiles":["G"],"role":"effect","source":{"selector":"createBaseSurfaceImages/scene.add/setDepth/0","expression":"DEPTH.BASES"}},
  {"id":"cpu:entities/DecoyEntity.ts:module/this.sprite/setDepth/0","owner":"entities/DecoyEntity.ts","component":"module/this.sprite/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.98],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.sprite/setDepth/0","expression":"DEPTH.PLAYERS - 0.02"}},
  {"id":"cpu:entities/DecoyEntity.ts:module/this.heldItem/HeldItemVisual/0","owner":"entities/DecoyEntity.ts","component":"module/this.heldItem/HeldItemVisual/0","height":"body","lighting":"material","camera":"world","depths":[9.985],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.heldItem/HeldItemVisual/0","expression":"DEPTH.PLAYERS - 0.015"}},
  {"id":"cpu:entities/DecoyEntity.ts:module/this.hpBarBg/setDepth/0","owner":"entities/DecoyEntity.ts","component":"module/this.hpBarBg/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[11],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.hpBarBg/setDepth/0","expression":"DEPTH.PLAYERS + 1"}},
  {"id":"cpu:entities/DecoyEntity.ts:module/this.hpBarFg/setDepth/0","owner":"entities/DecoyEntity.ts","component":"module/this.hpBarFg/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.hpBarFg/setDepth/0","expression":"DEPTH.PLAYERS + 2"}},
  {"id":"cpu:entities/DecoyEntity.ts:module/this.armorBarBg/setDepth/0","owner":"entities/DecoyEntity.ts","component":"module/this.armorBarBg/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[11],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.armorBarBg/setDepth/0","expression":"DEPTH.PLAYERS + 1"}},
  {"id":"cpu:entities/DecoyEntity.ts:module/this.armorBarFg/setDepth/0","owner":"entities/DecoyEntity.ts","component":"module/this.armorBarFg/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.armorBarFg/setDepth/0","expression":"DEPTH.PLAYERS + 2"}},
  {"id":"cpu:entities/EnemyEntity.ts:module/this.sprite/setDepth/0","owner":"entities/EnemyEntity.ts","component":"module/this.sprite/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.95],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.sprite/setDepth/0","expression":"DEPTH.PLAYERS - 0.05"}},
  {"id":"cpu:entities/EnemyEntity.ts:module/this.ownerRing/setDepth/0","owner":"entities/EnemyEntity.ts","component":"module/this.ownerRing/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.92],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.ownerRing/setDepth/0","expression":"DEPTH.PLAYERS - 0.08"}},
  {"id":"cpu:entities/EnemyEntity.ts:createGlowHalo/this.glowHalo/setDepth/0","owner":"entities/EnemyEntity.ts","component":"createGlowHalo/this.glowHalo/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.91],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createGlowHalo/this.glowHalo/setDepth/0","expression":"DEPTH.PLAYERS - 0.09"}},
  {"id":"cpu:entities/EnemyEntity.ts:syncVoidMolotovWindupVisuals/this.voidMolotovWindupRing/setDepth/0","owner":"entities/EnemyEntity.ts","component":"syncVoidMolotovWindupVisuals/this.voidMolotovWindupRing/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.96],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"syncVoidMolotovWindupVisuals/this.voidMolotovWindupRing/setDepth/0","expression":"this.sprite.depth + 0.01"}},
  {"id":"cpu:entities/EnemyEntity.ts:createBossDecorations/this.bossAura/setDepth/0","owner":"entities/EnemyEntity.ts","component":"createBossDecorations/this.bossAura/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.92],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"createBossDecorations/this.bossAura/setDepth/0","expression":"DEPTH.PLAYERS - 0.08"}},
  {"id":"cpu:entities/EnemyEntity.ts:createBossDecorations/this.bossRing/setDepth/0","owner":"entities/EnemyEntity.ts","component":"createBossDecorations/this.bossRing/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9.93],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"createBossDecorations/this.bossRing/setDepth/0","expression":"DEPTH.PLAYERS - 0.07"}},
  {"id":"cpu:entities/EnemyEntity.ts:createBossDecorations/this.bossLabel/setDepth/0","owner":"entities/EnemyEntity.ts","component":"createBossDecorations/this.bossLabel/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"createBossDecorations/this.bossLabel/setDepth/0","expression":"DEPTH.PLAYERS + 2"}},
  {"id":"cpu:entities/HeldItemVisual.ts:setDepth/this.image/setDepth/0","owner":"entities/HeldItemVisual.ts","component":"setDepth/this.image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"setDepth/this.image/setDepth/0","expression":"depth"}},
  {"id":"cpu:entities/HeldItemVisual.ts:setItem/this.image/setDepth/0","owner":"entities/HeldItemVisual.ts","component":"setItem/this.image/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"setItem/this.image/setDepth/0","expression":"this.depth"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.sprite/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.sprite/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.sprite/setDepth/0","expression":"DEPTH.PLAYERS"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.heldItem/HeldItemVisual/0","owner":"entities/PlayerEntity.ts","component":"module/this.heldItem/HeldItemVisual/0","height":"body","lighting":"material","camera":"world","depths":[10.02],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.heldItem/HeldItemVisual/0","expression":"DEPTH.PLAYERS + 0.02"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.spawnShine/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.spawnShine/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.05],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.spawnShine/setDepth/0","expression":"DEPTH.PLAYERS + 0.05"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.stealthShell/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.stealthShell/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.03],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.stealthShell/setDepth/0","expression":"DEPTH.PLAYERS + 0.03"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.stealthScan/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.stealthScan/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[10.04],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.stealthScan/setDepth/0","expression":"DEPTH.PLAYERS + 0.04"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.stealthAmbientParticles/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.stealthAmbientParticles/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10.01],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.stealthAmbientParticles/setDepth/0","expression":"DEPTH.PLAYERS + 0.01"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.stealthTrailParticles/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.stealthTrailParticles/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[10],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.stealthTrailParticles/setDepth/0","expression":"DEPTH.PLAYERS"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.armorBarBg/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.armorBarBg/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[11],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.armorBarBg/setDepth/0","expression":"DEPTH.PLAYERS + 1"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.armorBarFg/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.armorBarFg/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.armorBarFg/setDepth/0","expression":"DEPTH.PLAYERS + 2"}},
  {"id":"cpu:entities/PlayerEntity.ts:module/this.nameLabel/setDepth/0","owner":"entities/PlayerEntity.ts","component":"module/this.nameLabel/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[13],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.nameLabel/setDepth/0","expression":"DEPTH.PLAYERS + 3"}},
  {"id":"cpu:entities/WorldTurretVisual.ts:createWorldTurretVisual/scene.add/setDepth/0","owner":"entities/WorldTurretVisual.ts","component":"createWorldTurretVisual/scene.add/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.1],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createWorldTurretVisual/scene.add/setDepth/0","expression":"DEPTH.ROCKS + 0.1"}},
  {"id":"cpu:entities/WorldTurretVisual.ts:createWorldTurretVisual/scene.add/setDepth/1","owner":"entities/WorldTurretVisual.ts","component":"createWorldTurretVisual/scene.add/setDepth/1","height":"body","lighting":"emissive","camera":"world","depths":[9.2],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"createWorldTurretVisual/scene.add/setDepth/1","expression":"DEPTH.ROCKS + 0.2"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/radius/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/radius/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19],"blends":["ADD"],"profiles":["L"],"role":"effect","source":{"selector":"createVisual/radius/setDepth/0","expression":"DEPTH.CANOPY - 1"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/ring/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/ring/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[20],"blends":["ADD"],"profiles":["E","H"],"role":"effect","source":{"selector":"createVisual/ring/setDepth/0","expression":"DEPTH.CANOPY"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/outerRing/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/outerRing/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[20],"blends":["ADD"],"profiles":["E","H"],"role":"effect","source":{"selector":"createVisual/outerRing/setDepth/0","expression":"DEPTH.CANOPY"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/coreGlow/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/coreGlow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[8],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/coreGlow/setDepth/0","expression":"DEPTH.PLAYERS - 2"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/targetRing/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/targetRing/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/targetRing/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/shadow/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/shadow/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[8],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/shadow/setDepth/0","expression":"DEPTH.PLAYERS - 2"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/icon/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/icon/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/icon/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:powerups/NukeRenderer.ts:createVisual/sparks/setDepth/0","owner":"powerups/NukeRenderer.ts","component":"createVisual/sparks/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"createVisual/sparks/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:powerups/PowerUpPedestalGpuSystem.ts:configureLayer/layer/setDepth/0","owner":"powerups/PowerUpPedestalGpuSystem.ts","component":"configureLayer/layer/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[7.9,8,8.001],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"configureLayer/layer/setDepth/0","expression":"depth"}},
  {"id":"cpu:powerups/PowerUpRenderer.ts:sync/container/setDepth/0","owner":"powerups/PowerUpRenderer.ts","component":"sync/container/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[9],"blends":["NORMAL"],"profiles":["M"],"role":"effect","source":{"selector":"sync/container/setDepth/0","expression":"DEPTH.PLAYERS - 1"}},
  {"id":"cpu:powerups/PowerUpRenderer.ts:sync/itemAura/configureAdditiveImage/0","owner":"powerups/PowerUpRenderer.ts","component":"sync/itemAura/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[8.8],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"sync/itemAura/configureAdditiveImage/0","expression":"DEPTH.PLAYERS - 1.2"}},
  {"id":"cpu:powerups/PowerUpRenderer.ts:playMaterializeEffect/flash/configureAdditiveImage/0","owner":"powerups/PowerUpRenderer.ts","component":"playMaterializeEffect/flash/configureAdditiveImage/0","height":"body","lighting":"emissive","camera":"world","depths":[9.1],"blends":["ADD"],"profiles":["M"],"role":"effect","source":{"selector":"playMaterializeEffect/flash/configureAdditiveImage/0","expression":"DEPTH.PLAYERS - 0.9"}},
  {"id":"cpu:powerups/PowerUpRenderer.ts:playMaterializeEffect/pixelBurst/createEmitter/0","owner":"powerups/PowerUpRenderer.ts","component":"playMaterializeEffect/pixelBurst/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[9.15],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"playMaterializeEffect/pixelBurst/createEmitter/0","expression":"DEPTH.PLAYERS - 0.85"}},
  {"id":"cpu:powerups/PowerUpRenderer.ts:playMaterializeEffect/embers/createEmitter/0","owner":"powerups/PowerUpRenderer.ts","component":"playMaterializeEffect/embers/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[9.17],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"playMaterializeEffect/embers/createEmitter/0","expression":"DEPTH.PLAYERS - 0.83"}},
  {"id":"cpu:projectile/ProjectilePhysicsBinding.ts:createPhysicsHandle/sprite/setDepth/0","owner":"projectile/ProjectilePhysicsBinding.ts","component":"createPhysicsHandle/sprite/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"createPhysicsHandle/sprite/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:projectile/ProjectilePresentationRuntime.ts:drawClientFrame/sprite/setDepth/0","owner":"projectile/ProjectilePresentationRuntime.ts","component":"drawClientFrame/sprite/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[15],"blends":["NORMAL"],"profiles":["L"],"role":"effect","source":{"selector":"drawClientFrame/sprite/setDepth/0","expression":"DEPTH.PROJECTILES"}},
  {"id":"cpu:scenes/arena/EnemyFlowFieldDebugOverlay.ts:show/this.graphics/setDepth/0","owner":"scenes/arena/EnemyFlowFieldDebugOverlay.ts","component":"show/this.graphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"show/this.graphics/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:scenes/arena/GaussWarningRenderer.ts:module/this.gfx/setDepth/0","owner":"scenes/arena/GaussWarningRenderer.ts","component":"module/this.gfx/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[98],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.gfx/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:scenes/arena/PersistentBaseVisuals.ts:module/this.overlay/setDepth/0","owner":"scenes/arena/PersistentBaseVisuals.ts","component":"module/this.overlay/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[96],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.overlay/setDepth/0","expression":"DEPTH.OVERLAY - 4"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:module/this.rangeGraphics/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"module/this.rangeGraphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[98],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.rangeGraphics/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:module/this.turretRangeGraphics/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"module/this.turretRangeGraphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[8.8],"blends":["NORMAL"],"profiles":["M"],"role":"ui","source":{"selector":"module/this.turretRangeGraphics/setDepth/0","expression":"DEPTH.ROCKS - 0.2"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:module/this.invalidGraphics/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"module/this.invalidGraphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.invalidGraphics/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:module/this.remoteMissionPedestalPreviewGraphics/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"module/this.remoteMissionPedestalPreviewGraphics/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[97],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.remoteMissionPedestalPreviewGraphics/setDepth/0","expression":"DEPTH.OVERLAY - 3"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:module/this.errorText/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"module/this.errorText/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[100],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.errorText/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:ensurePlacementPreviewImage/this.localPlacementPreviewImage/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"ensurePlacementPreviewImage/this.localPlacementPreviewImage/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[98],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"ensurePlacementPreviewImage/this.localPlacementPreviewImage/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:ensurePlacementPreviewImage/created/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"ensurePlacementPreviewImage/created/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[97],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"ensurePlacementPreviewImage/created/setDepth/0","expression":"DEPTH.OVERLAY - 3"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:ensureTurretPreviewImage/this.localTurretPreviewImage/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"ensureTurretPreviewImage/this.localTurretPreviewImage/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"ensureTurretPreviewImage/this.localTurretPreviewImage/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:ensureTurretPreviewImage/image/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"ensureTurretPreviewImage/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[98],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"ensureTurretPreviewImage/image/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:createTunnelPreviewState/line/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"createTunnelPreviewState/line/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[9.685],"blends":["NORMAL"],"profiles":["K"],"role":"ui","source":{"selector":"createTunnelPreviewState/line/setDepth/0","expression":"TUNNEL_VISUAL_DEPTH + 0.025"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:createUtilityTargetingHint/container/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"createUtilityTargetingHint/container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"createUtilityTargetingHint/container/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:createAirstrikeTargetingHint/container/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"createAirstrikeTargetingHint/container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"createAirstrikeTargetingHint/container/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:scenes/arena/PlacementPreviewRenderer.ts:createPlaceableUtilityHint/container/setDepth/0","owner":"scenes/arena/PlacementPreviewRenderer.ts","component":"createPlaceableUtilityHint/container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"createPlaceableUtilityHint/container/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:scenes/arena/RockVisualHelper.ts:playRockDustBurst/emitter/createEmitter/0","owner":"scenes/arena/RockVisualHelper.ts","component":"playRockDustBurst/emitter/createEmitter/0","height":"body","lighting":"material","camera":"world","depths":[10],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"playRockDustBurst/emitter/createEmitter/0","expression":"DEPTH.ROCKS + 1"}},
  {"id":"cpu:scenes/arena/RockVisualHelper.ts:playTurretSpawnBurst/emitter/createEmitter/0","owner":"scenes/arena/RockVisualHelper.ts","component":"playTurretSpawnBurst/emitter/createEmitter/0","height":"body","lighting":"emissive","camera":"world","depths":[10],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"playTurretSpawnBurst/emitter/createEmitter/0","expression":"DEPTH.ROCKS + 1"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.shadow/setDepth/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.shadow/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[9.66],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.shadow/setDepth/0","expression":"depth"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.aura/configureAdditiveImage/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.aura/configureAdditiveImage/0","height":"ground","lighting":"emissive","camera":"world","depths":[9.67],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.aura/configureAdditiveImage/0","expression":"depth + 0.01"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.soil/setDepth/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.soil/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[9.68],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.soil/setDepth/0","expression":"depth + 0.02"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.rim/setDepth/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.rim/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[9.69],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.rim/setDepth/0","expression":"depth + 0.03"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.core/setDepth/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.core/setDepth/0","height":"ground","lighting":"material","camera":"world","depths":[9.7],"blends":["NORMAL"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.core/setDepth/0","expression":"depth + 0.04"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.dustEmitter/createEmitter/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.dustEmitter/createEmitter/0","height":"ground","lighting":"emissive","camera":"world","depths":[9.71],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.dustEmitter/createEmitter/0","expression":"depth + 0.05"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.moteEmitter/createEmitter/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.moteEmitter/createEmitter/0","height":"ground","lighting":"emissive","camera":"world","depths":[9.72],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.moteEmitter/createEmitter/0","expression":"depth + 0.06"}},
  {"id":"cpu:scenes/arena/TunnelEndpointVisual.ts:module/this.emberEmitter/createEmitter/0","owner":"scenes/arena/TunnelEndpointVisual.ts","component":"module/this.emberEmitter/createEmitter/0","height":"ground","lighting":"emissive","camera":"world","depths":[9.73],"blends":["ADD"],"profiles":["K"],"role":"effect","source":{"selector":"module/this.emberEmitter/createEmitter/0","expression":"depth + 0.07"}},
  {"id":"cpu:ui/AimSystem.ts:module/this.container/setDepth/0","owner":"ui/AimSystem.ts","component":"module/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.6],"blends":["NORMAL"],"profiles":["E"],"role":"ui","source":{"selector":"module/this.container/setDepth/0","expression":"DEPTH_AIM"}},
  {"id":"cpu:ui/AimVisuals.ts:module/this.chargeGfx/setDepth/0","owner":"ui/AimVisuals.ts","component":"module/this.chargeGfx/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.6],"blends":["NORMAL"],"profiles":["E"],"role":"ui","source":{"selector":"module/this.chargeGfx/setDepth/0","expression":"DEPTH_AIM"}},
  {"id":"cpu:ui/AimVisuals.ts:addImage/image/setDepth/0","owner":"ui/AimVisuals.ts","component":"addImage/image/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.6],"blends":["NORMAL"],"profiles":["E"],"role":"ui","source":{"selector":"addImage/image/setDepth/0","expression":"DEPTH_AIM"}},
  {"id":"cpu:ui/ArenaCountdownOverlay.ts:module/this.focusFallback/setDepth/0","owner":"ui/ArenaCountdownOverlay.ts","component":"module/this.focusFallback/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[98],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.focusFallback/setDepth/0","expression":"DEPTH.OVERLAY - 2"}},
  {"id":"cpu:ui/ArenaCountdownOverlay.ts:module/this.loadingBackdrop/setDepth/0","owner":"ui/ArenaCountdownOverlay.ts","component":"module/this.loadingBackdrop/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[96],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"module/this.loadingBackdrop/setDepth/0","expression":"DEPTH.OVERLAY - 4"}},
  {"id":"cpu:ui/ArenaCountdownOverlay.ts:module/this.loadingRoot/setDepth/0","owner":"ui/ArenaCountdownOverlay.ts","component":"module/this.loadingRoot/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[97],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"module/this.loadingRoot/setDepth/0","expression":"DEPTH.OVERLAY - 3"}},
  {"id":"cpu:ui/ArenaExitFadeOverlay.ts:build/this.wash/setDepth/0","owner":"ui/ArenaExitFadeOverlay.ts","component":"build/this.wash/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[103],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.wash/setDepth/0","expression":"DEPTH.OVERLAY + 3"}},
  {"id":"cpu:ui/BadgerPreview.ts:module/this.heldItem/HeldItemVisual/0","owner":"ui/BadgerPreview.ts","component":"module/this.heldItem/HeldItemVisual/0","height":"body","lighting":"emissive","camera":"world","depths":[0],"blends":["NORMAL"],"profiles":["G"],"role":"ui","source":{"selector":"module/this.heldItem/HeldItemVisual/0","expression":"0"}},
  {"id":"cpu:ui/BadgerPreview.ts:setDepth/this.sprite/setDepth/0","owner":"ui/BadgerPreview.ts","component":"setDepth/this.sprite/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"setDepth/this.sprite/setDepth/0","expression":"depth"}},
  {"id":"cpu:ui/BadgerPreview.ts:setDepth/this.heldItem/setDepth/0","owner":"ui/BadgerPreview.ts","component":"setDepth/this.heldItem/setDepth/0","height":"body","lighting":"material","camera":"world","depths":[],"blends":["NORMAL"],"profiles":[],"role":"delegate","source":{"selector":"setDepth/this.heldItem/setDepth/0","expression":"depth"}},
  {"id":"cpu:ui/CenterHUD.ts:build/this.container/setDepth/0","owner":"ui/CenterHUD.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[99],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/CoopDefenseItemRewardOverlay.ts:build/this.container/setDepth/0","owner":"ui/CoopDefenseItemRewardOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[105],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 5"}},
  {"id":"cpu:ui/CoopDefenseItemsOverlay.ts:build/this.container/setDepth/0","owner":"ui/CoopDefenseItemsOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[103],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 3"}},
  {"id":"cpu:ui/CoopDefenseObjectiveAnnouncement.ts:build/this.root/setDepth/0","owner":"ui/CoopDefenseObjectiveAnnouncement.ts","component":"build/this.root/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[100],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.root/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:ui/CoopDefenseSecondaryObjectiveHud.ts:build/this.root/setDepth/0","owner":"ui/CoopDefenseSecondaryObjectiveHud.ts","component":"build/this.root/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[99],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.root/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/CoopDefenseTutorialPanel.ts:buildTutorialPanel/this.tutorialContainer/setDepth/0","owner":"ui/CoopDefenseTutorialPanel.ts","component":"buildTutorialPanel/this.tutorialContainer/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"buildTutorialPanel/this.tutorialContainer/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/CoopDefenseTutorialPanel.ts:buildTutorialStepPanel/this.tutorialStepContainer/setDepth/0","owner":"ui/CoopDefenseTutorialPanel.ts","component":"buildTutorialStepPanel/this.tutorialStepContainer/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[99],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"buildTutorialStepPanel/this.tutorialStepContainer/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/CoopDefenseUpgradesOverlay.ts:build/tooltipRoot/setDepth/0","owner":"ui/CoopDefenseUpgradesOverlay.ts","component":"build/tooltipRoot/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[103],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"build/tooltipRoot/setDepth/0","expression":"DEPTH.OVERLAY + 3"}},
  {"id":"cpu:ui/CoopDefenseUpgradesOverlay.ts:build/this.container/setDepth/0","owner":"ui/CoopDefenseUpgradesOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[101],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 1"}},
  {"id":"cpu:ui/EnemyHoverNameLabel.ts:module/this.text/setDepth/0","owner":"ui/EnemyHoverNameLabel.ts","component":"module/this.text/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[22],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.text/setDepth/0","expression":"DEPTH.LOCAL_UI"}},
  {"id":"cpu:ui/HelpOverlay.ts:build/this.container/setDepth/0","owner":"ui/HelpOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[101],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 1"}},
  {"id":"cpu:ui/HostileBaseIndicator.ts:module/this.worldArrow/setDepth/0","owner":"ui/HostileBaseIndicator.ts","component":"module/this.worldArrow/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[12],"blends":["NORMAL"],"profiles":["K"],"role":"ui","source":{"selector":"module/this.worldArrow/setDepth/0","expression":"DEPTH.BASES + 8"}},
  {"id":"cpu:ui/HostileBaseIndicator.ts:module/this.edgeArrow/setDepth/0","owner":"ui/HostileBaseIndicator.ts","component":"module/this.edgeArrow/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[100],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"module/this.edgeArrow/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:ui/LeftSidePanel.ts:build/this.gameContainer/setDepth/0","owner":"ui/LeftSidePanel.ts","component":"build/this.gameContainer/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[99],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.gameContainer/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/LeftSidePanel.ts:build/this.lobbyContainer/setDepth/0","owner":"ui/LeftSidePanel.ts","component":"build/this.lobbyContainer/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[99],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.lobbyContainer/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/LeftSidePanel.ts:build/this.badgerPreview/setDepth/0","owner":"ui/LeftSidePanel.ts","component":"build/this.badgerPreview/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[100],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"build/this.badgerPreview/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:ui/LeftSidePanel.ts:buildPickerContainer/container/setDepth/0","owner":"ui/LeftSidePanel.ts","component":"buildPickerContainer/container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[102],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"buildPickerContainer/container/setDepth/0","expression":"DEPTH.OVERLAY + 2"}},
  {"id":"cpu:ui/LoadoutSlotPicker.ts:open/this.container/setDepth/0","owner":"ui/LoadoutSlotPicker.ts","component":"open/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[102,103],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"open/this.container/setDepth/0","expression":"this.depth"}},
  {"id":"cpu:ui/LobbyPlayerProgress.ts:build/tooltipRoot/setDepth/0","owner":"ui/LobbyPlayerProgress.ts","component":"build/tooltipRoot/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[102],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/tooltipRoot/setDepth/0","expression":"DEPTH.OVERLAY + 2"}},
  {"id":"cpu:ui/LobbyPlayerProgress.ts:build/baseTooltipRoot/setDepth/0","owner":"ui/LobbyPlayerProgress.ts","component":"build/baseTooltipRoot/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[102],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/baseTooltipRoot/setDepth/0","expression":"DEPTH.OVERLAY + 2"}},
  {"id":"cpu:ui/MatchResultsOverlay.ts:build/this.container/setDepth/0","owner":"ui/MatchResultsOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[104],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 4"}},
  {"id":"cpu:ui/OptionsOverlay.ts:build/this.container/setDepth/0","owner":"ui/OptionsOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[101],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 1"}},
  {"id":"cpu:ui/PlasmaBurnerOverloadIndicator.ts:module/this.empty/setDepth/0","owner":"ui/PlasmaBurnerOverloadIndicator.ts","component":"module/this.empty/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.6],"blends":["NORMAL"],"profiles":["E"],"role":"ui","source":{"selector":"module/this.empty/setDepth/0","expression":"DEPTH_AIM"}},
  {"id":"cpu:ui/PlasmaBurnerOverloadIndicator.ts:module/this.fill/setDepth/0","owner":"ui/PlasmaBurnerOverloadIndicator.ts","component":"module/this.fill/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.61],"blends":["NORMAL"],"profiles":["E"],"role":"ui","source":{"selector":"module/this.fill/setDepth/0","expression":"DEPTH_AIM + 0.01"}},
  {"id":"cpu:ui/PlayerStatusRing.ts:module/this.container/setDepth/0","owner":"ui/PlayerStatusRing.ts","component":"module/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[22],"blends":["NORMAL"],"profiles":["H"],"role":"ui","source":{"selector":"module/this.container/setDepth/0","expression":"DEPTH.LOCAL_UI"}},
  {"id":"cpu:ui/RadialActionMenu.ts:build/container/setDepth/0","owner":"ui/RadialActionMenu.ts","component":"build/container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[42],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/container/setDepth/0","expression":"DEPTH.LOCAL_UI + 20"}},
  {"id":"cpu:ui/RightSidePanel.ts:buildGameContainer/this.gameContainer/setDepth/0","owner":"ui/RightSidePanel.ts","component":"buildGameContainer/this.gameContainer/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[99],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"buildGameContainer/this.gameContainer/setDepth/0","expression":"DEPTH.OVERLAY - 1"}},
  {"id":"cpu:ui/RocketMagazineIndicator.ts:module/this.root/setDepth/0","owner":"ui/RocketMagazineIndicator.ts","component":"module/this.root/setDepth/0","height":"body","lighting":"emissive","camera":"world","depths":[19.61],"blends":["NORMAL"],"profiles":["E"],"role":"ui","source":{"selector":"module/this.root/setDepth/0","expression":"DEPTH_AIM + 0.01"}},
  {"id":"cpu:ui/RoomStatisticsOverlay.ts:build/this.container/setDepth/0","owner":"ui/RoomStatisticsOverlay.ts","component":"build/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[105],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"build/this.container/setDepth/0","expression":"DEPTH.OVERLAY + 5"}},
  {"id":"cpu:ui/RoundStartCountdownView.ts:module/this.root/setDepth/0","owner":"ui/RoundStartCountdownView.ts","component":"module/this.root/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[100],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"module/this.root/setDepth/0","expression":"DEPTH.OVERLAY"}},
  {"id":"cpu:ui/ScopeOverlay.ts:module/this.image/setDepth/0","owner":"ui/ScopeOverlay.ts","component":"module/this.image/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[99.5],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"module/this.image/setDepth/0","expression":"DEPTH.OVERLAY - 0.5"}},
  {"id":"cpu:ui/UiContextMenu.ts:open/this.container/setDepth/0","owner":"ui/UiContextMenu.ts","component":"open/this.container/setDepth/0","height":"body","lighting":"emissive","camera":"clarity","depths":[103],"blends":["NORMAL"],"profiles":["C"],"role":"ui","source":{"selector":"open/this.container/setDepth/0","expression":"this.standaloneDepth"}},
];
export const CPU_SOURCE_CONTRACTS = {
  "adrenalineEssence/AdrenalineEssenceGpuRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.glow/setDepth/0",
        "expression": "GLOW_DEPTH",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.body/setDepth/0",
        "expression": "BODY_DEPTH",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "arena/BaseAccentGlowRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/overlay/setDepth/0",
        "expression": "source.depth + depth",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "source.depth": [
        4
      ],
      "depth": [
        0.04,
        0.05
      ]
    }
  },
  "effects/AirstrikeRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/warningFill/setDepth/0",
        "expression": "DEPTH.CANOPY - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/warningRing/setDepth/0",
        "expression": "DEPTH.CANOPY",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/innerRing/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/coreGlow/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/crossH/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/crossV/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/Ak47StrategicTargetRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "build/container/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/AsmdPrimaryRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "playTracer/segment/setDepth/0",
        "expression": "DEPTH_TRACE + 0.02 + centerT * 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpact/halo/setDepth/0",
        "expression": "DEPTH_TRACE + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/flash/setDepth/0",
        "expression": "DEPTH_TRACE + 0.13",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/sparks/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.12",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMuzzleBurst/bloom/setDepth/0",
        "expression": "DEPTH_TRACE + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMuzzleBurst/flare/setDepth/0",
        "expression": "DEPTH_TRACE + 0.11",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMuzzleBurst/core/setDepth/0",
        "expression": "DEPTH_TRACE + 0.12",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMuzzleBurst/sparks/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.13",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playBeamParticles/flow/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.08",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playBeamParticles/front/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactArcs/gfx/setDepth/0",
        "expression": "DEPTH_TRACE + 0.14",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "centerT": [
        0,
        1
      ]
    }
  },
  "effects/AttackDroneRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "syncVisuals/image/setDepth/0",
        "expression": "DEPTH.ROCKS + .1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "syncVisuals/setDepth/setDepth/0",
        "expression": "DEPTH.PROJECTILES + .5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createDrone/marker/setDepth/0",
        "expression": "depth + .02",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createDrone/this.scene.add/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createDrone/this.scene.add/setDepth/1",
        "expression": "depth + .01",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createDrone/this.scene.add/setDepth/2",
        "expression": "DEPTH.ROCKS - .01",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createDrone/this.scene.add/setDepth/3",
        "expression": "depth + .03",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/BfgRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/coreEmitter/createEmitter/0",
        "expression": "DEPTH_BFG + 0.05",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/outerEmitter/createEmitter/0",
        "expression": "DEPTH_BFG",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/sparkEmitter/createEmitter/0",
        "expression": "DEPTH_SPARK",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/glowImage/configureAdditiveImage/0",
        "expression": "DEPTH_BFG - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createBeamVisual/root/setDepth/0",
        "expression": "BFG_BEAM_DEPTH",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/BiteRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "playSwing/slash/setDepth/0",
        "expression": "DEPTH_TRACE + 0.04",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playClawWake/wake/setDepth/0",
        "expression": "DEPTH_TRACE + 0.08",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playVolumeParticles/blood/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playVolumeParticles/flecks/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.11",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/mark/setDepth/0",
        "expression": "DEPTH_TRACE + 0.14",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactBurst/gore/setDepth/0",
        "expression": "DEPTH_TRACE + 0.145",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactBurst/mist/setDepth/0",
        "expression": "DEPTH_TRACE + 0.146",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/blood/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.16",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactBurst/chips/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.17",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playAirSnap/snap/setDepth/0",
        "expression": "DEPTH_TRACE + 0.12",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/BlackHoleRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "play/core/setDepth/0",
        "expression": "DEPTH.FIRE - 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "play/horizon/setDepth/0",
        "expression": "DEPTH.FIRE - 0.07",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "play/collapseRipple/setDepth/0",
        "expression": "DEPTH.FIRE - 0.035",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "play/outerOrbitEmitter/createEmitter/0",
        "expression": "DEPTH.FIRE - 0.055",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "play/wispEmitter/createEmitter/0",
        "expression": "DEPTH.FIRE - 0.052",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "play/innerOrbitEmitter/createEmitter/0",
        "expression": "DEPTH.FIRE - 0.05",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/BloodEffectShared.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "spawnBloodStain/stain/setDepth/0",
        "expression": "config.depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "config.depth": [
        9.95
      ]
    }
  },
  "effects/BulletRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/bullet/setDepth/0",
        "expression": "DEPTH_BULLET",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/accent/configureAdditiveImage/0",
        "expression": "DEPTH_ACCENT",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/trail/setDepth/0",
        "expression": "DEPTH_TRAIL",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/glow/configureAdditiveImage/0",
        "expression": "DEPTH_GLOW",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createChargeFx/aura/configureAdditiveImage/0",
        "expression": "DEPTH_AURA",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactSparks/emitter/setDepth/0",
        "expression": "DEPTH_SPARK",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactSparks/impactFlash/configureAdditiveImage/0",
        "expression": "DEPTH_SPARK",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CaptureTheBeerRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "update/visual.container/setDepth/0",
        "expression": "isCarried ? BEER_DEPTH + 0.35 : BEER_DEPTH + 0.12",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/container/setDepth/0",
        "expression": "BEER_DEPTH",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/outerGlow/configureAdditiveImage/0",
        "expression": "BEER_DEPTH - 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/innerGlow/configureAdditiveImage/0",
        "expression": "BEER_DEPTH - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/aura/configureAdditiveImage/0",
        "expression": "BEER_DEPTH - 0.05",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/idleEmitter/createEmitter/0",
        "expression": "BEER_DEPTH + 0.26",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/bubbleEmitter/createEmitter/0",
        "expression": "BEER_DEPTH + 0.22",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "spawnTrailPuff/foam/configureAdditiveImage/0",
        "expression": "BEER_DEPTH + 0.04",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "spawnTrailPuff/bubble/configureAdditiveImage/0",
        "expression": "BEER_DEPTH + 0.08",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playResetTeleport/halo/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 0.9",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "spawnTeleportSwirl/bubble/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 0.82",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playFoamBurst/foamEmitter/createEmitter/0",
        "expression": "DEPTH_FX + 0.66",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playFoamBurst/bubbleEmitter/createEmitter/0",
        "expression": "DEPTH_FX + 0.7",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playPulseHalo/halo/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 0.52",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreScreenFlash/colorWash/setDepth/0",
        "expression": "DEPTH_FX + 1.75",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreScreenFlash/whiteWash/setDepth/0",
        "expression": "DEPTH_FX + 1.8",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreScreenFlash/centerHalo/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 1.82",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreScreenFlash/centerCore/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 1.84",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreLightBurst/beam/setDepth/0",
        "expression": "DEPTH_FX + 0.95",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreLightBurst/core/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 1.02",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreLightBurst/corona/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 1.01",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreFoamShell/shell/createEmitter/0",
        "expression": "DEPTH_FX + 0.86",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playScoreFoamShell/plume/createEmitter/0",
        "expression": "DEPTH_FX + 0.88",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playRing/ring/setDepth/0",
        "expression": "DEPTH_FX + 0.6",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "spawnAfterglow/afterglow/configureAdditiveImage/0",
        "expression": "DEPTH_FX + 0.3",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/ConstructionOwnershipGpuSystem.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.passiveLayer/setDepth/0",
        "expression": "DEPTH.ROCKS - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.activeLayer/setDepth/0",
        "expression": "DEPTH.ROCKS + 0.3",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CoopDefenseCarryZoneRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/spawn/setDepth/0",
        "expression": "DEPTH.GROUND_FOG + 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/delivery/setDepth/0",
        "expression": "DEPTH.GROUND_FOG + 0.1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CoopDefenseEncounterTelegraphRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.graphics/setDepth/0",
        "expression": "DEPTH_FX",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "generateTextures/edge/setDepth/0",
        "expression": "DEPTH_FX - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "generateTextures/haze/setDepth/0",
        "expression": "DEPTH_FX - 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "generateTextures/drift/setDepth/0",
        "expression": "DEPTH_FX + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "generateTextures/crest/setDepth/0",
        "expression": "DEPTH_FX + 0.15",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CoopDefenseMissionProgressRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createCheckpoints/quad/setDepth/0",
        "expression": "DEPTH.ROCKS - 0.5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "syncBarriers/image/setDepth/0",
        "expression": "DEPTH.ROCKS",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [
      "promoteToClarityCamera(this.scene, arrow)",
      "promoteToClarityCamera(this.scene, label)"
    ],
    "sites": [
      {
        "key": "build/container/setDepth/0",
        "expression": "DEPTH.BASES + 8",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "build/arrow/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "build/label/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CoopXpTextRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createPopup/outline/setDepth/0",
        "expression": "DEPTH.OVERLAY - 5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createPopup/label/setDepth/0",
        "expression": "DEPTH.OVERLAY - 5",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/CorpseMarkerRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "show/shadow/setDepth/0",
        "expression": "DEPTH_CORPSE_CROSS_SHADOW",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "show/cross/setDepth/0",
        "expression": "DEPTH_CORPSE_CROSS",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/EffectSystem.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [
      "promoteToClarityCamera(this.scene, edge)"
    ],
    "sites": [
      {
        "key": "playTrainExplosionEffect/flash/setDepth/0",
        "expression": "DEPTH_FX + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playTrainExplosionEffect/skyFlash/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playHitEffect/criticalRing/setDepth/0",
        "expression": "DEPTH_FX + 0.35",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playHitEffect/criticalLabel/setDepth/0",
        "expression": "DEPTH_FX + 0.4",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playDashTrailGhost/ghost/setDepth/0",
        "expression": "DEPTH_FX - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playTrainBurrowSparks/sparks/setDepth/0",
        "expression": "DEPTH_FX + 0.35",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playStealthTransitionEffect/core/setDepth/0",
        "expression": "DEPTH_FX + 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playStealthTransitionEffect/ring/setDepth/0",
        "expression": "DEPTH_FX + 0.16",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playStealthTransitionEffect/outerRing/setDepth/0",
        "expression": "DEPTH_FX + 0.12",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playStealthTransitionEffect/pixel/setDepth/0",
        "expression": "DEPTH_FX + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playStealthTransitionEffect/dust/setDepth/0",
        "expression": "DEPTH_FX + 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playStealthTransitionEffect/spark/setDepth/0",
        "expression": "DEPTH_FX + 0.22",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureBurrowVisual/dirt/setDepth/0",
        "expression": "DEPTH_FX - 0.2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureBurrowVisual/dust/setDepth/0",
        "expression": "DEPTH_FX - 0.25",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playBurrowPhaseEffect/ring/setDepth/0",
        "expression": "DEPTH_FX + 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playBurrowPhaseEffect/dirtBurst/setDepth/0",
        "expression": "DEPTH_FX + 0.08",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playBurrowPhaseEffect/plume/setDepth/0",
        "expression": "DEPTH_FX + 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playExplosionEffect/core/setDepth/0",
        "expression": "DEPTH_FX + 0.4",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playExplosionEffect/skyFlash/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playExplosionEffect/flash/setDepth/0",
        "expression": "DEPTH_FX + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playExplosionEffect/skyFlash/setDepth/1",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playLightningExplosionEffect/flash/setDepth/0",
        "expression": "DEPTH_FX + 0.45",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playLightningExplosionEffect/arcs/setDepth/0",
        "expression": "DEPTH_FX + 0.35",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playBroodHatchEffect/lobe/setDepth/0",
        "expression": "DEPTH_FX + 0.12",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playRegenerationEffect/core/setDepth/0",
        "expression": "DEPTH_FX + 0.4",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playRegenerationEffect/ring/setDepth/0",
        "expression": "DEPTH_FX + 0.3 - ringIndex * 0.02",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playCountdownText/label/setDepth/0",
        "expression": "DEPTH.OVERLAY - 5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playHitscanTracer/gfx/setDepth/0",
        "expression": "DEPTH_TRACE",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playHitscanImpact/halo/setDepth/0",
        "expression": "DEPTH_TRACE + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMeleeSwingEffect/gfx/setDepth/0",
        "expression": "DEPTH_FX",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "spawnBloodStain/depth/depth/0",
        "expression": "DEPTH_BLOOD_STAIN",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureDamageVignette/createEdge/setDepth/0",
        "expression": "DEPTH_DAMAGE_VIGNETTE",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playPlayerDeathAnimation/sprite/setDepth/0",
        "expression": "DEPTH_FX + 0.1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "ringIndex": [
        0,
        1,
        2
      ]
    }
  },
  "effects/EffectUtils.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createEmitter/emitter/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "configureAdditiveImage/image/setDepth/0",
        "expression": "depth",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "depth": [
        5,
        10,
        16,
        25
      ]
    }
  },
  "effects/EnemyClawRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/ground/createEnemyClawGpuLayer/0",
        "expression": "DEPTH.PLAYERS - 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/top/createEnemyClawGpuLayer/0",
        "expression": "DEPTH_TRACE",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/night/createEnemyClawGpuLayer/0",
        "expression": "DEPTH_LIGHTING + 0.08",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/EnemyEyeBatch.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.layer/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        5,
        10,
        16,
        25
      ]
    }
  },
  "effects/EnemyEyeGlowRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.aura/EnemyEyeBatch/0",
        "expression": "DEPTH_LIGHTING + .09",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.socket/EnemyEyeBatch/0",
        "expression": "DEPTH_LIGHTING + .095",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.bloom/EnemyEyeBatch/0",
        "expression": "DEPTH_LIGHTING + .1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.halo/EnemyEyeBatch/0",
        "expression": "DEPTH_LIGHTING + .11",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.core/EnemyEyeBatch/0",
        "expression": "DEPTH_LIGHTING + .12",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/EnemyReadabilityRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createLayer/layer/setDepth/0",
        "expression": "s.depth - 0.001",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "s.depth": [
        9.95
      ]
    }
  },
  "effects/EnemyVulnerabilityRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createLayer/layer/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        9.88,
        9.89,
        9.955,
        19.585
      ]
    }
  },
  "effects/EnergyBallRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/coreEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/shellEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 0.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/glowImage/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES - 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/shellImage/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.8",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/glow/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.4",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/shell/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/sparkEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1.45",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/EnergyInjectorRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/halo/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/ring/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/sparks/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.15",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/EnergyShieldRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/halo/configureAdditiveImage/0",
        "expression": "DEPTH.FIRE + 0.20",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/outerGlow/setDepth/0",
        "expression": "DEPTH.FIRE + 0.19",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/glow/setDepth/0",
        "expression": "DEPTH.FIRE + 0.22",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/core/setDepth/0",
        "expression": "DEPTH.FIRE + 0.24",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/rimEmitter/createEmitter/0",
        "expression": "DEPTH.FIRE + 0.21",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/flowEmitter/createEmitter/0",
        "expression": "DEPTH.FIRE + 0.23",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/sparkEmitter/createEmitter/0",
        "expression": "DEPTH.FIRE + 0.25",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/domeField/setDepth/0",
        "expression": "DEPTH.FIRE + 0.20",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/EntityBurnRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.glowImage/setDepth/0",
        "expression": "DEPTH_BURN_GLOW",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/FireballRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.tail/createEmitter/0",
        "expression": "DEPTH.PROJECTILES - 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.sparks/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/glow/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/core/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/FlameRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/glowImage/setDepth/0",
        "expression": "DEPTH_FLAME - 0.1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/FlamethrowerUpgradeRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "playFireChunkBurst/chunk/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.4",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createRingVisual/quad/setDepth/0",
        "expression": "RING_DEPTH",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/GaussRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/halo/configureAdditiveImage/0",
        "expression": "DEPTH_GAUSS_HALO",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/core/configureAdditiveImage/0",
        "expression": "DEPTH_GAUSS_CORE",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/arcEmitter/createEmitter/0",
        "expression": "DEPTH_GAUSS_ARC",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/GrenadeRenderer.ts": {
    "blends": [
      "(cfg.trailAdditive ?? true) ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL",
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/glow/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/body/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/detail/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/trail/createEmitter/0",
        "expression": "DEPTH.PROJECTILES - 0.2",
        "blends": [
          "ADD",
          "NORMAL"
        ]
      },
      {
        "key": "spawnFirePuff/puff/setDepth/0",
        "expression": "isVoid ? DEPTH.PROJECTILES - 0.3 : DEPTH.FIRE",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/GroundHazardWarningRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "sync/image/setDepth/0",
        "expression": "DEPTH.FIRE - 0.1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/GuardianSpiritRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/halo/configureAdditiveImage/0",
        "expression": "SPIRIT_DEPTH - 0.03",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/core/configureAdditiveImage/0",
        "expression": "SPIRIT_DEPTH + 0.03",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/wingLeft/configureAdditiveImage/0",
        "expression": "SPIRIT_DEPTH",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/wingRight/configureAdditiveImage/0",
        "expression": "SPIRIT_DEPTH",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/trail/createEmitter/0",
        "expression": "SPIRIT_DEPTH - 0.08",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/motes/createEmitter/0",
        "expression": "SPIRIT_DEPTH - 0.05",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/ring/configureAdditiveImage/0",
        "expression": "SPIRIT_DEPTH + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playBurst/emitter/createEmitter/0",
        "expression": "SPIRIT_DEPTH + 0.12",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/HealingAuraRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "syncAura/field/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS - 0.18",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "syncAura/ring/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.17",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "spawnHealingBurst/particle/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS + 0.3",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/HitFeedbackRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "syncSlot/slot.image/setDepth/0",
        "expression": "sprite.depth + DEPTH_OFFSET",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "sprite.depth": [
        9.95,
        10
      ]
    }
  },
  "effects/HolyExplosionRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "spawnEmblem/layers/depth/0",
        "expression": "DEPTH_FX + 0.42",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "spawnEmblem/layers/depth/1",
        "expression": "DEPTH_FX + 0.44",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "spawnEmblem/layers/depth/2",
        "expression": "DEPTH_FX + 0.46",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "image/image/setDepth/0",
        "expression": "depth",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "depth": [
        25.2,
        25.42,
        25.44,
        25.46,
        25.5
      ]
    }
  },
  "effects/HolyGrenadeRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/glow/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/body/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/trim/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/pin/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.3",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/sparkEmitter/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.4",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/HoneyBadgerRageRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.outerAura/setDepth/0",
        "expression": "DEPTH_RAGE_AURA_OUTER",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.coreAura/setDepth/0",
        "expression": "DEPTH_RAGE_AURA_CORE",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.ringAura/setDepth/0",
        "expression": "DEPTH_RAGE_AURA_CORE + 0.01",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.bloodEmitter/createEmitter/0",
        "expression": "DEPTH_RAGE_BLOOD",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playBloodBurst/streak/setDepth/0",
        "expression": "DEPTH_RAGE_SPLASH",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playBloodBurst/depth/depth/0",
        "expression": "DEPTH_RAGE_STAIN",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playBloodBurst/droplet/setDepth/0",
        "expression": "DEPTH_RAGE_SPLASH + 0.01",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/HydraRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/glow/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES - 0.25",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/membrane/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.7",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/cluster/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.55",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/coreEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/shellEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 0.85",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/moteEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 0.95",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/glow/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.4",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/cluster/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.52",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/membrane/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.6",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/burst/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1.75",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playSplitImpact/pulse/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playSplitImpact/emitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1.85",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playSplitImpact/wisp/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.9",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/LightingSystem.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.MULTIPLY",
      "Phaser.BlendModes.SCREEN"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "syncLightBleed/quad/setDepth/0",
        "expression": "DEPTH_LIGHTING + 0.001",
        "blends": [
          "SCREEN"
        ]
      },
      {
        "key": "ensureLightMap/lightMap/setDepth/0",
        "expression": "DEPTH_LIGHTING",
        "blends": [
          "MULTIPLY"
        ]
      },
      {
        "key": "createOccluderSlot/renderTexture/setDepth/0",
        "expression": "DEPTH_LIGHTING - 0.01 + slotIndex * 0.001",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "slotIndex": [
        0,
        1,
        2,
        3
      ]
    }
  },
  "effects/LowHealthBloodOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, image)"
    ],
    "sites": [
      {
        "key": "ensureObjects/createLayer/setDepth/0",
        "expression": "DEPTH_LOW_HEALTH_BLOOD",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/MeteorRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createWarningVisual/warningCircle/setDepth/0",
        "expression": "DEPTH_WARNING",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createWarningVisual/warningFill/setDepth/0",
        "expression": "DEPTH_WARNING - 0.01",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createWarningVisual/shadow/setDepth/0",
        "expression": "DEPTH_WARNING - 0.02",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createWarningVisual/meteorGlow/setDepth/0",
        "expression": "DEPTH_METEOR",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createWarningVisual/trailEmitter/setDepth/0",
        "expression": "DEPTH_METEOR + 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactEffect/flash/setDepth/0",
        "expression": "DEPTH_IMPACT + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactEffect/blast/setDepth/0",
        "expression": "DEPTH_IMPACT",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactEffect/ring/setDepth/0",
        "expression": "DEPTH_IMPACT",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactEffect/sparkEmitter/setDepth/0",
        "expression": "DEPTH_IMPACT + 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactEffect/emberEmitter/setDepth/0",
        "expression": "DEPTH_IMPACT",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playImpactEffect/scorch/setDepth/0",
        "expression": "DEPTH_WARNING - 0.1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/MiniTeslaDomeRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "syncDome/visual/depth/0",
        "expression": "DEPTH.PLAYERS - 0.14",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "syncDome/visual/boltDepth/0",
        "expression": "DEPTH.PLAYERS + 0.12",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/MolotovFirewalkerRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.glow/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS - 0.02",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.sparks/createEmitter/0",
        "expression": "DEPTH.PLAYERS + 0.12",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/PlasmaBurnerChargeRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/make/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/PlasmaBurnerRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createBeamQuad/quad/setDepth/0",
        "expression": "DEPTH_TRACE + 0.16",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/PlasmaChargeRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.coreEmitter/setDepth/0",
        "expression": "CHARGE_CORE_DEPTH",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.sparkEmitter/setDepth/0",
        "expression": "CHARGE_SPARK_DEPTH",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.glowImage/setDepth/0",
        "expression": "CHARGE_GLOW_DEPTH",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/PressureShieldRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.shell/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS + 0.18",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.echo/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS + 0.19",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/ProjectileBurnRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "sync/glow/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.28",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/ReinforcementMatrixRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/carpet/setDepth/0",
        "expression": "DEPTH.DECALS + 0.4",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/ring/setDepth/0",
        "expression": "DEPTH.DECALS + 0.45",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/sparks/setDepth/0",
        "expression": "DEPTH.DECALS + 0.5",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/RemoteControlRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/halo/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.24",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/ring/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.18",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/sparks/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.12",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/RepairDroneEffects.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.surface/setDepth/0",
        "expression": "REPAIR_DRONE_DEPTH - 0.012",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.light/setDepth/0",
        "expression": "REPAIR_DRONE_DEPTH + 0.012",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/RockDestructionRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "activateFragment/image/setDepth/0",
        "expression": "DEPTH_TRACE - 0.15",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureSharedEmitters/this.sharedDustEmitter/createEmitter/0",
        "expression": "DEPTH_TRACE - 0.3",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureSharedEmitters/this.sharedDebrisEmitter/createEmitter/0",
        "expression": "DEPTH_TRACE - 0.25",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "prewarmFragmentPool/image/setDepth/0",
        "expression": "DEPTH_TRACE - 0.15",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/RocketRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/body/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/accent/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/glow/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/engine/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playCollection/ring/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playCollection/burst/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/SharedGlowSystem.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createBandBuffer/image/setDepth/0",
        "expression": "cameraMode === 'world' ? DEPTH.CANOPY - 0.01 : DEPTH.OVERLAY - 0.5",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/ShootingRangeRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.controlIcons/setDepth/0",
        "expression": "DEPTH.ROCKS + 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.targetGlows/setDepth/0",
        "expression": "DEPTH.DECALS + 0.2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.supplyGlows/setDepth/0",
        "expression": "DEPTH.DECALS + 0.1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.panel/setDepth/0",
        "expression": "DEPTH.LOCAL_UI",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "graphics/graphics/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        5.1
      ]
    }
  },
  "effects/SlimeTrailRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "playBloomBurst/chunk/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.48",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createBubbleEmitter/createEmitter/createEmitter/0",
        "expression": "depth",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createGlintEmitter/createEmitter/createEmitter/0",
        "expression": "SLIME_GROUND_DEPTH + 0.06",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createRippleEmitter/createEmitter/createEmitter/0",
        "expression": "SLIME_GROUND_DEPTH + 0.04",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "syncPuddles/image/setDepth/0",
        "expression": "SLIME_GROUND_DEPTH",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "syncAffectedEnemies/visual/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.38",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "depth": [
        8.7,
        15.42
      ]
    }
  },
  "effects/SmokeBodyEffect.ts": {
    "blends": [
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.scatter/setDepth/0",
        "expression": "DEPTH.SMOKE + .05",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "update/wisp/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "update/this.arcs/setDepth/0",
        "expression": "depth + .01",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "sprite.depth": [
        9.95,
        10
      ]
    }
  },
  "effects/SmokeSystem.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "renderFrame/this.surface/setDepth/0",
        "expression": "DEPTH.SMOKE",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "updateStatusEffects/ring/setDepth/0",
        "expression": "DEPTH.SMOKE + 0.3",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/SpawnEffectRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "playAfterglow/glow/setDepth/0",
        "expression": "DEPTH_FX - 0.7",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playEnemyCoreBurst/core/setDepth/0",
        "expression": "DEPTH_FX + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playEnemyParticleBurst/emitter/setDepth/0",
        "expression": "DEPTH_FX + 0.5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playCoreBurst/core/setDepth/0",
        "expression": "DEPTH_FX + 1.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playCoreBurst/halo/setDepth/0",
        "expression": "DEPTH_FX + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "spawnRing/ring/setDepth/0",
        "expression": "DEPTH_FX",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playBeam/beam/setDepth/0",
        "expression": "DEPTH_FX - 0.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playBeam/beamGlow/setDepth/0",
        "expression": "DEPTH_FX - 0.6",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playParticleBurst/emitter/setDepth/0",
        "expression": "DEPTH_FX + 0.5",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/SporeRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/glow/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES - 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/cluster/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/coreEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/wakeEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/glow/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.3",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/cluster/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 1.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/burst/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 1.7",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/haze/createEmitter/0",
        "expression": "DEPTH.FIRE + 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "spawnTrailPuff/puff/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.3",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/StinkCloudBody.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.quad/setDepth/0",
        "expression": "DEPTH.STINK",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/StinkCloudSystem.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "isElectric || isVoidSpore ? Phaser.BlendModes.ADD : Phaser.BlendModes.MULTIPLY"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/groundGlow/setDepth/0",
        "expression": "STINK_DEPTH - 0.12",
        "blends": [
          "ADD",
          "MULTIPLY"
        ]
      },
      {
        "key": "createVisual/damageAura/setDepth/0",
        "expression": "STINK_DEPTH - 0.08",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/reactionPulse/setDepth/0",
        "expression": "STINK_DEPTH - 0.04",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/electricArcs/setDepth/0",
        "expression": "STINK_DEPTH + 0.1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/StinkPlagueRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "update/body.image/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "update/wisp/setDepth/0",
        "expression": "depth + .01",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "update/image/setDepth/0",
        "expression": "DEPTH.SMOKE - .11",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "sprite.depth": [
        9.95,
        10
      ]
    }
  },
  "effects/TeslaBoltRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/halos/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/sparks/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.22",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/arcs/setDepth/0",
        "expression": "DEPTH.PROJECTILES + 0.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpact/flash/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.3",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "ensureImpactEmitter/this.impactEmitter/createEmitter/0",
        "expression": "DEPTH.PROJECTILES + 0.31",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/TeslaDomeRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/depth/depth/0",
        "expression": "DEPTH.FIRE + 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/boltDepth/boltDepth/0",
        "expression": "DEPTH.FIRE + 0.2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/TeslaFieldVisual.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createDomeQuad/quad/setDepth/0",
        "expression": "this.options.depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createBoltSlot/quad/setDepth/0",
        "expression": "this.options.boltDepth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "this.options.depth": [
        9.86,
        16.05
      ],
      "this.options.boltDepth": [
        10.12,
        16.2
      ]
    }
  },
  "effects/TeslaNovaRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createQuad/quad/setDepth/0",
        "expression": "DEPTH.FIRE + 0.26",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/TimeBubbleRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.SCREEN",
      "i ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/membrane/setDepth/0",
        "expression": "DEPTH.FIRE + 0.42",
        "blends": [
          "SCREEN"
        ]
      },
      {
        "key": "createVisual/interferenceA/setDepth/0",
        "expression": "DEPTH.FIRE + 0.48",
        "blends": [
          "SCREEN"
        ]
      },
      {
        "key": "createVisual/interferenceB/setDepth/0",
        "expression": "DEPTH.FIRE + 0.5",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "updatePrismCenter/visual.prismHalo/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.3",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "updatePrismCenter/visual.prismCore/setDepth/0",
        "expression": "DEPTH.PROJECTILES - 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "updateResonance/this.scene.add/setDepth/0",
        "expression": "DEPTH.FIRE + 0.52 + i * 0.01",
        "blends": [
          "ADD",
          "NORMAL"
        ]
      },
      {
        "key": "updateResonance/visual.chargeSparks/createEmitter/0",
        "expression": "DEPTH.FIRE + 0.56",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "i": [
        0,
        1,
        2
      ]
    }
  },
  "effects/TimebombFuseRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.ring/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.04",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.sparks/setDepth/0",
        "expression": "DEPTH.PLAYERS + 0.08",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "emitCountdownText/label/setDepth/0",
        "expression": "DEPTH.PLAYERS + 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/TracerBounceDebugOverlay.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "draw/this.graphics/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/TranslocatorPuckRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/baseImage/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/glowImage/configureAdditiveImage/0",
        "expression": "DEPTH.PROJECTILES + 0.1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/TranslocatorTeleportRenderer.ts": {
    "blends": [
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "syncPortals/graphics/setDepth/0",
        "expression": "DEPTH_FX - 0.2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "animate/g/setDepth/0",
        "expression": "DEPTH_FX",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/WorldInteractionRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "sync/this.marker/setDepth/0",
        "expression": "DEPTH.LOCAL_UI",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "sync/this.label/setDepth/0",
        "expression": "DEPTH.LOCAL_UI + 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/ZeusTaserRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "syncUpgrades/this.statusLayer/setDepth/0",
        "expression": "DEPTH_TRACE + 0.3",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playSwing/sector/setDepth/0",
        "expression": "DEPTH_TRACE + 0.04",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playOriginBurst/halo/setDepth/0",
        "expression": "DEPTH_TRACE + 0.08",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playOriginBurst/streak/setDepth/0",
        "expression": "DEPTH_TRACE + 0.09",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playOriginBurst/sparks/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playVolumeParticles/volume/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.07",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playVolumeParticles/rim/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.11",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/chain/setDepth/0",
        "expression": "DEPTH_TRACE + 0.13",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/halo/setDepth/0",
        "expression": "DEPTH_TRACE + 0.14",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/flash/setDepth/0",
        "expression": "DEPTH_TRACE + 0.15",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/sparks/createEmitter/0",
        "expression": "DEPTH_TRACE + 0.16",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playImpactBurst/branches/setDepth/0",
        "expression": "DEPTH_TRACE + 0.15",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playTerminusPulse/pulse/setDepth/0",
        "expression": "DEPTH_TRACE + 0.12",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playTerminusPulse/core/setDepth/0",
        "expression": "DEPTH_TRACE + 0.13",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/earthbreak/EarthbreakFissureGpuLayer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createEarthbreakFissureGpuLayer/image/setDepth/0",
        "expression": "depth",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/0",
        "expression": "DEPTH.DECALS + 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createEarthbreakFissureLayers/layers/createEarthbreakFissureGpuLayer/1",
        "expression": "DEPTH_LIGHTING + 0.07",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        5,
        10,
        16,
        25
      ]
    }
  },
  "effects/enemyClaw/EnemyClawGpuLayer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createEnemyClawGpuLayer/image/setDepth/0",
        "expression": "depth",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "depth": [
        5,
        10,
        16,
        25
      ]
    }
  },
  "effects/health/WorldHealthBarRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "borrowView/view.background/setDepth/0",
        "expression": "s.backgroundDepth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "borrowView/view.trail/setDepth/0",
        "expression": "(s.backgroundDepth + s.fillDepth) / 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "borrowView/view.fill/setDepth/0",
        "expression": "s.fillDepth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "s.backgroundDepth": [
        5.8,
        9.35,
        11,
        18.5
      ],
      "s.fillDepth": [
        6,
        9.4,
        12,
        18.6
      ],
      "(s.backgroundDepth + s.fillDepth) / 2": [
        5.9,
        9.375,
        11.5,
        18.55
      ]
    }
  },
  "effects/health/healthBarStyles.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "enemyHealthBarStyle/backgroundDepth/backgroundDepth/0",
        "expression": "DEPTH.SMOKE + 0.5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "enemyHealthBarStyle/fillDepth/fillDepth/0",
        "expression": "DEPTH.SMOKE + 0.6",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playerHealthBarStyle/backgroundDepth/backgroundDepth/0",
        "expression": "DEPTH.PLAYERS + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playerHealthBarStyle/fillDepth/fillDepth/0",
        "expression": "DEPTH.PLAYERS + 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "baseHealthBarStyle/backgroundDepth/backgroundDepth/0",
        "expression": "DEPTH.GROUND_FOG + .5",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "baseHealthBarStyle/fillDepth/fillDepth/0",
        "expression": "DEPTH.GROUND_FOG + .7",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/TURRET_HEALTH_BAR_STYLE/backgroundDepth/0",
        "expression": "DEPTH.ROCKS + 0.35",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/TURRET_HEALTH_BAR_STYLE/fillDepth/0",
        "expression": "DEPTH.ROCKS + 0.4",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "effects/repairDroneVisuals.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createRepairDroneBody/scene.add/setDepth/0",
        "expression": "REPAIR_DRONE_DEPTH",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "entities/BaseEntity.ts": {
    "blends": [
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createPresentationRepresentation/image/setDepth/0",
        "expression": "DEPTH.BASES + 3",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createPresentationRepresentation/marker/setDepth/0",
        "expression": "DEPTH.BASES + 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "setVulnerable/marker/setDepth/0",
        "expression": "DEPTH.BASES + 5",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "entities/BaseVisuals.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createBaseSurfaceImages/scene.add/setDepth/0",
        "expression": "DEPTH.BASES",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "entities/DecoyEntity.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.sprite/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.02",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.heldItem/HeldItemVisual/0",
        "expression": "DEPTH.PLAYERS - 0.015",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.hpBarBg/setDepth/0",
        "expression": "DEPTH.PLAYERS + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.hpBarFg/setDepth/0",
        "expression": "DEPTH.PLAYERS + 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.armorBarBg/setDepth/0",
        "expression": "DEPTH.PLAYERS + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.armorBarFg/setDepth/0",
        "expression": "DEPTH.PLAYERS + 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "entities/EnemyEntity.ts": {
    "blends": [
      "makeAdditive"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.sprite/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.05",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.ownerRing/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.08",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createGlowHalo/this.glowHalo/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.09",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "syncVoidMolotovWindupVisuals/this.voidMolotovWindupRing/setDepth/0",
        "expression": "this.sprite.depth + 0.01",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createBossDecorations/this.bossAura/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.08",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createBossDecorations/this.bossRing/setDepth/0",
        "expression": "DEPTH.PLAYERS - 0.07",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createBossDecorations/this.bossLabel/setDepth/0",
        "expression": "DEPTH.PLAYERS + 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "this.sprite.depth": [
        9.95
      ]
    }
  },
  "entities/HeldItemVisual.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "setDepth/this.image/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "setItem/this.image/setDepth/0",
        "expression": "this.depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        5,
        10,
        16,
        25
      ],
      "this.depth": [
        9.985,
        10.02
      ]
    }
  },
  "entities/PlayerEntity.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.sprite/setDepth/0",
        "expression": "DEPTH.PLAYERS",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.heldItem/HeldItemVisual/0",
        "expression": "DEPTH.PLAYERS + 0.02",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.spawnShine/setDepth/0",
        "expression": "DEPTH.PLAYERS + 0.05",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.stealthShell/setDepth/0",
        "expression": "DEPTH.PLAYERS + 0.03",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.stealthScan/setDepth/0",
        "expression": "DEPTH.PLAYERS + 0.04",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.stealthAmbientParticles/setDepth/0",
        "expression": "DEPTH.PLAYERS + 0.01",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.stealthTrailParticles/setDepth/0",
        "expression": "DEPTH.PLAYERS",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.armorBarBg/setDepth/0",
        "expression": "DEPTH.PLAYERS + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.armorBarFg/setDepth/0",
        "expression": "DEPTH.PLAYERS + 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.nameLabel/setDepth/0",
        "expression": "DEPTH.PLAYERS + 3",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "entities/WorldTurretVisual.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createWorldTurretVisual/scene.add/setDepth/0",
        "expression": "DEPTH.ROCKS + 0.1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createWorldTurretVisual/scene.add/setDepth/1",
        "expression": "DEPTH.ROCKS + 0.2",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "powerups/NukeRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "createVisual/radius/setDepth/0",
        "expression": "DEPTH.CANOPY - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/ring/setDepth/0",
        "expression": "DEPTH.CANOPY",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/outerRing/setDepth/0",
        "expression": "DEPTH.CANOPY",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/coreGlow/setDepth/0",
        "expression": "DEPTH.PLAYERS - 2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/targetRing/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "createVisual/shadow/setDepth/0",
        "expression": "DEPTH.PLAYERS - 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/icon/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createVisual/sparks/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "powerups/PowerUpPedestalGpuSystem.ts": {
    "blends": [
      "blendMode"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "configureLayer/layer/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        7.9,
        8,
        8.001
      ]
    }
  },
  "powerups/PowerUpRenderer.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "sync/container/setDepth/0",
        "expression": "DEPTH.PLAYERS - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "sync/itemAura/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS - 1.2",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMaterializeEffect/flash/configureAdditiveImage/0",
        "expression": "DEPTH.PLAYERS - 0.9",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMaterializeEffect/pixelBurst/createEmitter/0",
        "expression": "DEPTH.PLAYERS - 0.85",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "playMaterializeEffect/embers/createEmitter/0",
        "expression": "DEPTH.PLAYERS - 0.83",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "projectile/ProjectilePhysicsBinding.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "createPhysicsHandle/sprite/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "projectile/ProjectilePresentationRuntime.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "drawClientFrame/sprite/setDepth/0",
        "expression": "DEPTH.PROJECTILES",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "scenes/arena/EnemyFlowFieldDebugOverlay.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "show/this.graphics/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "scenes/arena/GaussWarningRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.gfx/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "scenes/arena/PersistentBaseVisuals.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.overlay/setDepth/0",
        "expression": "DEPTH.OVERLAY - 4",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "scenes/arena/PlacementPreviewRenderer.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.rangeGraphics/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.turretRangeGraphics/setDepth/0",
        "expression": "DEPTH.ROCKS - 0.2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.invalidGraphics/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.remoteMissionPedestalPreviewGraphics/setDepth/0",
        "expression": "DEPTH.OVERLAY - 3",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.errorText/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensurePlacementPreviewImage/this.localPlacementPreviewImage/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensurePlacementPreviewImage/created/setDepth/0",
        "expression": "DEPTH.OVERLAY - 3",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureTurretPreviewImage/this.localTurretPreviewImage/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "ensureTurretPreviewImage/image/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createTunnelPreviewState/line/setDepth/0",
        "expression": "TUNNEL_VISUAL_DEPTH + 0.025",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createUtilityTargetingHint/container/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createAirstrikeTargetingHint/container/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "createPlaceableUtilityHint/container/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "scenes/arena/RockVisualHelper.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "playRockDustBurst/emitter/createEmitter/0",
        "expression": "DEPTH.ROCKS + 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "playTurretSpawnBurst/emitter/createEmitter/0",
        "expression": "DEPTH.ROCKS + 1",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {}
  },
  "scenes/arena/TunnelEndpointVisual.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.shadow/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.aura/configureAdditiveImage/0",
        "expression": "depth + 0.01",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.soil/setDepth/0",
        "expression": "depth + 0.02",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.rim/setDepth/0",
        "expression": "depth + 0.03",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.core/setDepth/0",
        "expression": "depth + 0.04",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.dustEmitter/createEmitter/0",
        "expression": "depth + 0.05",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.moteEmitter/createEmitter/0",
        "expression": "depth + 0.06",
        "blends": [
          "ADD"
        ]
      },
      {
        "key": "module/this.emberEmitter/createEmitter/0",
        "expression": "depth + 0.07",
        "blends": [
          "ADD"
        ]
      }
    ],
    "bindings": {
      "depth": [
        9.66
      ]
    }
  },
  "ui/AimSystem.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.container/setDepth/0",
        "expression": "DEPTH_AIM",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/AimVisuals.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.chargeGfx/setDepth/0",
        "expression": "DEPTH_AIM",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "addImage/image/setDepth/0",
        "expression": "DEPTH_AIM",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/ArenaCountdownOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(scene, this.loadingBackdrop)",
      "promoteToClarityCamera(scene, this.loadingRoot)"
    ],
    "sites": [
      {
        "key": "module/this.focusFallback/setDepth/0",
        "expression": "DEPTH.OVERLAY - 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.loadingBackdrop/setDepth/0",
        "expression": "DEPTH.OVERLAY - 4",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.loadingRoot/setDepth/0",
        "expression": "DEPTH.OVERLAY - 3",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/ArenaExitFadeOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.wash)"
    ],
    "sites": [
      {
        "key": "build/this.wash/setDepth/0",
        "expression": "DEPTH.OVERLAY + 3",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/BadgerPreview.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.heldItem/HeldItemVisual/0",
        "expression": "0",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "setDepth/this.sprite/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "setDepth/this.heldItem/setDepth/0",
        "expression": "depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "depth": [
        100
      ]
    }
  },
  "ui/CenterHUD.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/CoopDefenseItemRewardOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 5",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/CoopDefenseItemsOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 3",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/CoopDefenseObjectiveAnnouncement.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.root)"
    ],
    "sites": [
      {
        "key": "build/this.root/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/CoopDefenseSecondaryObjectiveHud.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.root)"
    ],
    "sites": [
      {
        "key": "build/this.root/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/CoopDefenseTutorialPanel.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "buildTutorialPanel/this.tutorialContainer/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "buildTutorialStepPanel/this.tutorialStepContainer/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/CoopDefenseUpgradesOverlay.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/tooltipRoot/setDepth/0",
        "expression": "DEPTH.OVERLAY + 3",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/EnemyHoverNameLabel.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.text/setDepth/0",
        "expression": "DEPTH.LOCAL_UI",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/HelpOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/HostileBaseIndicator.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(scene, this.edgeArrow)"
    ],
    "sites": [
      {
        "key": "module/this.worldArrow/setDepth/0",
        "expression": "DEPTH.BASES + 8",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.edgeArrow/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/LeftSidePanel.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, image)",
      "promoteToClarityCamera(this.scene, this.badgerPreview.sprite)",
      "promoteToClarityCamera(this.scene, this.gameContainer)",
      "promoteToClarityCamera(this.scene, this.lobbyContainer)",
      "promoteToClarityCamera(this.scene, this.pickerContainer)"
    ],
    "sites": [
      {
        "key": "build/this.gameContainer/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "build/this.lobbyContainer/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "build/this.badgerPreview/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "buildPickerContainer/container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/LoadoutSlotPicker.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "open/this.container/setDepth/0",
        "expression": "this.depth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "this.depth": [
        102,
        103
      ]
    }
  },
  "ui/LobbyPlayerProgress.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, baseTooltipRoot)",
      "promoteToClarityCamera(this.scene, tooltipRoot)"
    ],
    "sites": [
      {
        "key": "build/tooltipRoot/setDepth/0",
        "expression": "DEPTH.OVERLAY + 2",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "build/baseTooltipRoot/setDepth/0",
        "expression": "DEPTH.OVERLAY + 2",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/MatchResultsOverlay.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 4",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/OptionsOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/PlasmaBurnerOverloadIndicator.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.empty/setDepth/0",
        "expression": "DEPTH_AIM",
        "blends": [
          "NORMAL"
        ]
      },
      {
        "key": "module/this.fill/setDepth/0",
        "expression": "DEPTH_AIM + 0.01",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/PlayerStatusRing.ts": {
    "blends": [
      "Phaser.BlendModes.ADD",
      "Phaser.BlendModes.NORMAL"
    ],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.container/setDepth/0",
        "expression": "DEPTH.LOCAL_UI",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/RadialActionMenu.ts": {
    "blends": [
      "Phaser.BlendModes.ADD"
    ],
    "cameras": [
      "promoteToClarityCamera(scene, container)"
    ],
    "sites": [
      {
        "key": "build/container/setDepth/0",
        "expression": "DEPTH.LOCAL_UI + 20",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/RightSidePanel.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.gameContainer)"
    ],
    "sites": [
      {
        "key": "buildGameContainer/this.gameContainer/setDepth/0",
        "expression": "DEPTH.OVERLAY - 1",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/RocketMagazineIndicator.ts": {
    "blends": [],
    "cameras": [],
    "sites": [
      {
        "key": "module/this.root/setDepth/0",
        "expression": "DEPTH_AIM + 0.01",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/RoomStatisticsOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "build/this.container/setDepth/0",
        "expression": "DEPTH.OVERLAY + 5",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/RoundStartCountdownView.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(scene, this.root)"
    ],
    "sites": [
      {
        "key": "module/this.root/setDepth/0",
        "expression": "DEPTH.OVERLAY",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/ScopeOverlay.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(scene, this.image)"
    ],
    "sites": [
      {
        "key": "module/this.image/setDepth/0",
        "expression": "DEPTH.OVERLAY - 0.5",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {}
  },
  "ui/UiContextMenu.ts": {
    "blends": [],
    "cameras": [
      "promoteToClarityCamera(this.scene, this.container)"
    ],
    "sites": [
      {
        "key": "open/this.container/setDepth/0",
        "expression": "this.standaloneDepth",
        "blends": [
          "NORMAL"
        ]
      }
    ],
    "bindings": {
      "this.standaloneDepth": [
        103
      ]
    }
  }
};
export const EFFECT_LAYER_CONTRACTS: readonly LayerContract[] = [...Object.values(GPU_LAYER_CONTRACTS), ...Object.values(GPU_EFFECT_CONTRACTS), ...CPU_LAYER_CONTRACTS];
