/** World pixels (32 px ≈ 1 m). Cosmetic tuning only; never read by gameplay. */
export const AMBIENT_WILDLIFE = {
  visualScale: 1.3,
  butterfly: { size: 5.2, speed: 4, fleeSpeed: 18, alertRadius: 64, turnRate: 2.4, maxCount: 120, density: .85, animationRate: 14 },
  moth: { size: 6.5, speed: 5, fleeSpeed: 72, alertRadius: 64, turnRate: 4.8, maxCount: 90, density: 1, animationRate: 17 },
  firefly: { size: 2.4, speed: 4.5, fleeSpeed: 72, alertRadius: 112, turnRate: 6, maxCount: 40, density: .3, animationRate: 12 },
  // World minutes: each insect chooses its own point inside these windows.
  insectMorning: [7 * 60, 8 * 60 + 30],
  insectEvening: [18 * 60 + 15, 19 * 60 + 45],
  fireflyDawn: [5 * 60, 6 * 60],
  fireflyNight: [21 * 60, 22 * 60],
  insectSettleSeconds: 2,
  insectFadeSeconds: 3,
  fireflyGlowRadius: 23,
  mothColors: [0x928779, 0xa69a82, 0x827d75, 0x9b927f, 0x867967],
  snake: { size: 24, speed: 9, fleeSpeed: 32, alertRadius: 96, turnRate: 1.6, maxCount: 96,
    treeOccupancy: .25, groupChance: .04, thirdSnakeChance: .15 },
  fish: { size: 4.5, speed: 11, fleeSpeed: 96, alertRadius: 160, turnRate: 3, maxCount: 96, density: .8 },
  // One disturbance rule for every kind. Bodies (players, enemies) alarm within alertRadius,
  // measured to their edge; impulses reach alertRadius * alertScale + radius * blastScale.
  disturbance: {
    simulationMarginPx: 192,
    moverCapacity: 256,
    gridCellPx: 256,
    movingPx: .08,
    movingHoldSeconds: .2,
    shot: { alertScale: 2, blastScale: 0, seconds: 1.6 },
    explosion: { alertScale: 2.5, blastScale: 2, seconds: 3 },
  },
  butterflyFlightSeconds: 5,
  butterflyRestSeconds: 30,
  snakeSizes: [.85, 1, 1.22],
  snakeVisual: { scale: 1.2, segments: 28, waveAmplitude: 2.1, waveLength: 7.2,
    tongueColor: 0xb84b58, tongueLength: 2.2, tongueWidth: .28,
    tonguePeriod: 4, tongueJitter: 1.7, tongueMinDuration: .2, tongueMaxDuration: .35 },
  snakeColors: [
    { name: 'Olivgrün', body: 0x424b2c, head: 0x58603b, pattern: 0x303820, highlight: 0x73764a },
    { name: 'Erdbraun', body: 0x594431, head: 0x6c5339, pattern: 0x382d24, highlight: 0x8c7050 },
  ],
  fishGroups: [
    { name: 'Kleinfischschwarm', minCount: 5, maxCount: 7, sizeScale: 1, widthScale: 1, spread: 8 },
    { name: 'Kleine Gruppe', minCount: 2, maxCount: 4, sizeScale: 1.4, widthScale: 1.3, spread: 7 },
    { name: 'Einzelfisch', minCount: 1, maxCount: 1, sizeScale: 1.95, widthScale: 1.65, spread: 0 },
  ],
  fishColors: [
    { name: 'Silbergrau', body: 0x29454a, back: 0xadc1c0 },
    { name: 'Blaugrau', body: 0x2b4958, back: 0x93b7c8 },
    { name: 'Oliv', body: 0x3b4d35, back: 0xaab990 },
    { name: 'Kupferbraun', body: 0x574736, back: 0xc0a479 },
  ],
  fishFleeSeconds: .65,
  fishDiveSeconds: 1.5,
  fishHiddenSeconds: 3.5,
  fishEmergeSeconds: 1.8,
  butterflyColors: [0xefc96b, 0x8cc5eb, 0xc69ee0, 0xf2e7c8, 0xe69b67],
  // Birds. Speeds px/s, heights px above ground, spot and hop ranges in cells around the roost tree.
  // Sizes are a little above true scale so a flock still reads at play distance.
  // `speed` is the walking pace on the ground (sparrow flocks stand and peck). Sparrows and magpies
  // cruise below the crowns, ravens and owls above them. `beat` is the projected wing-span loss at
  // the ends of a stroke, `handFlex` how far the hand folds back on the upstroke (radians).
  sparrow: { size: 7.2, speed: 0, fleeSpeed: 150, cruiseSpeed: 110, alertRadius: 112, turnRate: 6, maxCount: 18,
    occupancy: .45, flockMin: 4, flockMax: 9, spread: 9, cruiseHeight: 34, climbRate: 70, flapHz: 7, beat: .2, handFlex: .4,
    spotCount: 6, spotRange: [2.5, 7], hopRange: [3, 8], calmSeconds: [25, 70] },
  sparrowShore: { spots: 2, range: 12, chance: .35, drinkSeconds: [6, 14], standOff: 13, lateralSpacing: 4.4 },
  // Each flock member flies its own path: it chases its slot in the loose formation with its own
  // speed and response, so the flock never moves as one rigid body.
  sparrowMembers: { formationSpread: 2.4, wander: 3.2, response: 3.2, accel: 5, speedVariation: .14, turnRate: 9 },
  magpie: { size: 16, speed: 16, fleeSpeed: 120, cruiseSpeed: 92, alertRadius: 104, turnRate: 4, maxCount: 10,
    occupancy: .15, cruiseHeight: 38, climbRate: 50, flapHz: 3.1, beat: .12, handFlex: .5,
    spotCount: 6, spotRange: [8, 22], hopRange: [10, 26], calmSeconds: [20, 55],
    roamRadius: 80, walkSeconds: [1.2, 3], pauseSeconds: [.8, 2.4] },
  raven: { size: 24, speed: 14, fleeSpeed: 108, cruiseSpeed: 82, alertRadius: 136, turnRate: 2.6, maxCount: 6,
    occupancy: .08, cruiseHeight: 118, climbRate: 40, flapHz: 1.7, beat: .07, handFlex: .55,
    spotCount: 6, spotRange: [8, 24], hopRange: [12, 30], calmSeconds: [25, 70],
    roamRadius: 104, walkSeconds: [1.6, 3.6], pauseSeconds: [1, 3] },
  owl: { size: 13, speed: 88, fleeSpeed: 125, cruiseSpeed: 88, alertRadius: 88, turnRate: 1.4, maxCount: 6,
    occupancy: .06, cruiseHeight: 124, climbRate: 52, flapHz: 2.4, beat: .08, handFlex: .6, territory: 36,
    circleChance: .12, diveChance: .15, mantleSeconds: [.5, 1], climbSeconds: 2.4, veerSeconds: 2.5 },
  owlBrownShare: .7,
  birdFlight: {
    // Below c0 a bird flies under tree crowns, above c2 over them. Inside the band it rises out of
    // (or sinks into) the leaves; flights never level off inside it.
    crownBand: [44, 76, 84], emergeHeight: 40, emergeSeconds: 1.4,
    // Rising from the ground the bird leaves the ground fog gradually over these heights.
    fogLift: [16, 22],
    takeoffSeconds: .55, landingRadius: 90, alertCooldownSeconds: 1.2, frameInset: 8,
  },
  // World minutes; each bird picks its own moment inside the window.
  birdSchedule: {
    sparrowDawn: [330, 390], sparrowDusk: [1170, 1230],
    corvidDawn: [345, 420], corvidDusk: [1185, 1250],
    owlDawn: [285, 345], owlDusk: [1230, 1290],
  },
} as const;
