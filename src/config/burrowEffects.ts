/** Player emergence: heavy earth leads the silhouette; soft dust stays below combat actors. */
export const BURROW_FX = {
  eventCapacity: 128,
  flightCapacity: 1024,
  groundCapacity: 2048,
  clodReserve: 256,
  flightLifeMinMs: 250,
  flightLifeMaxMs: 450,
  clodLifeMinMs: 1000,
  clodLifeMaxMs: 2000,
  dustLifeMinMs: 500,
  dustLifeMaxMs: 800,
  terrainFallback: 0x9c8868,
  earthTint: 0x4d331f,
  earthTintMix: 0.76,
  dustTint: 0xddd0af,
  dustTintMix: 0.7,
  enter: {
    clods: 42, grains: 24, dust: 8, spreadMin: 20, spreadMax: 44, originRadius: 7,
    frontOffset: 8, sideOffset: 6, fanOffset: 0.83, fanHalfWidth: 0.28,
    scale: 0.84, flightLifeFactor: 0.8, dustScale: 0.72, dustLifeFactor: 0.85,
  },
  entryAnimation: {
    braceFraction: 0.24, braceWidth: 1.08, braceLength: 0.88,
    sinkWidth: 0.76, sinkLength: 0.7, fadeStart: 0.68,
  },
  exit: { clods: 60, grains: 30, dust: 12, spreadMin: 26, spreadMax: 68, originRadius: 12 },
  dash: { clods: 6, grains: 3, spreadMin: 16, spreadMax: 38, fan: 2.3, originRadius: 6 },
  underground: {
    maxSources: 128, stationaryIntervalMs: 135, movingIntervalMs: 70,
    maxFrameMs: 150, teleportDistance: 96, minMoveSpeed: 8, motionHoldMs: 120,
    stationary: {
      clods: 5, grains: 6, dust: 2, spreadMin: 6, spreadMax: 13, originRadius: 6,
      scale: 0.625, flightLifeFactor: 0.9, dustScale: 0.4, dustLifeFactor: 0.65,
    },
    moving: {
      clods: 8, grains: 6, dust: 3, spreadMin: 10, spreadMax: 22, originRadius: 8,
      scale: 0.8, flightLifeFactor: 1, dustScale: 0.52, dustLifeFactor: 0.75,
    },
  },
  clod: {
    largeFraction: 0.2, mediumFraction: 0.55,
    largeScale: 0.68, mediumScale: 0.43, smallScale: 0.23,
    scaleVariation: 0.32, landingScale: 0.8, alpha: 0.96, landingAlpha: 0.82,
    spinMin: 2.2, spinMax: 6.5,
  },
  // DeathDustMote canvases are 48 px, but their actual grains occupy only 2–5 px.
  grain: { scaleMin: 0.45, scaleMax: 0.85, alpha: 0.76, spreadFactor: 1.2 },
  dust: {
    diameterMin: 18, diameterMax: 27, growth: 2.5,
    travelMin: 12, travelMax: 28, alpha: 0.36, spin: 0.85,
  },
  shockwave: { lifeMs: 360, alpha: 0.62, tint: 0xd7bd85, startRadiusFactor: 0.15 },
} as const;
