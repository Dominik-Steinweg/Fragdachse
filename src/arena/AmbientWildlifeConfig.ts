/** World pixels (32 px ≈ 1 m). Cosmetic tuning only; never read by gameplay. */
export const AMBIENT_WILDLIFE = {
  visualScale: 1.3,
  butterfly: { size: 5.2, speed: 4, fleeSpeed: 18, alertRadius: 64, turnRate: 2.4, maxCount: 120, density: .85, animationRate: 14 },
  snake: { size: 24, speed: 9, fleeSpeed: 32, alertRadius: 96, turnRate: 1.6, maxCount: 96 },
  fish: { size: 4.5, speed: 11, fleeSpeed: 96, alertRadius: 160, turnRate: 3, maxCount: 96, density: .8 },
  shotRadiusScale: 2,
  shotAlertSeconds: 1.6,
  butterflyFlightSeconds: 5,
  butterflyRestSeconds: 30,
  snakeSizes: [.85, 1, 1.22],
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
} as const;
