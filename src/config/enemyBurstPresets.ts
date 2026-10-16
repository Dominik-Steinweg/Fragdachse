/** Splash looks of enemy area bursts (death bursts, landing shocks); gameplay lives in the burst config. */
export type EnemyBurstPresentation = 'ink' | 'plague' | 'mud';

export interface EnemyBurstPreset {
  readonly style: 'brood_hatch';
  readonly color: number;
}

export const ENEMY_BURST_PRESETS: Readonly<Record<EnemyBurstPresentation, EnemyBurstPreset>> = {
  // The brood's dark violet goo, no vision-blocking cloud.
  ink: { style: 'brood_hatch', color: 0x3c1160 },
  // Bruised violet-magenta rot of the plague toad: enemy danger, deliberately not the mint of its heal.
  plague: { style: 'brood_hatch', color: 0x7a2462 },
  // Mud thrown up by a heavy landing.
  mud: { style: 'brood_hatch', color: 0x4a3f26 },
};
