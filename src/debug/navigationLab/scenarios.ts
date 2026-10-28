export const NAVIGATION_SCENARIO_VERSION = 5;
export const NAVIGATION_BENCHMARK_SEEDS = [1, 17, 183, 731, 1337, 8191, 424242, 20260916, 987654321, 20260817] as const;

/** Dev-only navigation link in 32-px world cells; the lab snaps both ends to free ground. */
export interface NavigationLabPortalLink {
  readonly id: string;
  readonly entry: { readonly gridX: number; readonly gridY: number };
  readonly exit: { readonly gridX: number; readonly gridY: number };
  readonly radiusPx: number;
  readonly maxBodyRadiusPx: number;
  readonly costPx: number;
}

export interface NavigationLabScenario {
  readonly id: string;
  readonly mapId: string;
  readonly description: string;
  readonly combat: boolean;
  readonly allyFraction: number;
  readonly kinds: readonly string[];
  readonly portalLink?: NavigationLabPortalLink;
  /** Reference player near this world cell instead of the arena center. */
  readonly playerCell?: { readonly gridX: number; readonly gridY: number };
  /** Spawn band in world cells instead of the 256-800 px ring around the player. */
  readonly spawnArea?: { readonly gridX: number; readonly gridY: number; readonly widthCells: number; readonly heightCells: number };
}

export const NAVIGATION_LAB_SCENARIOS: readonly NavigationLabScenario[] = [
  { id: 'rock-field', mapId: '0', description: 'Felsfeld / bestehende Bewegung', combat: false,
    allyFraction: 0, kinds: ['rabid-rabbit', 'pyro-badger', 'void-stalker', 'alien-badger'] },
  { id: 'siege', mapId: '6', description: 'Basen / Belagerung', combat: true,
    allyFraction: 0, kinds: ['zombie-badger', 'demon-badger', 'spore-warden', 'plague-medic'] },
  { id: 'combat', mapId: '10', description: 'Gemischtes Kampfgeschehen', combat: true,
    allyFraction: 0, kinds: ['rabid-rabbit', 'pyro-badger', 'alien-badger', 'void-stalker', 'thrower-badger'] },
  { id: 'allies', mapId: '6', description: 'Feinde und Verbuendete', combat: true,
    allyFraction: 0.2, kinds: ['rabid-rabbit', 'zombie-badger', 'pyro-badger'] },
  // Map 08 west waves: a link around the bastion line (x = 63) to the far side of the rear base (79,26).
  { id: 'portal-flank', mapId: '8', description: 'Portal-Flanke um die Bastionslinie', combat: false,
    allyFraction: 0, kinds: ['void-stalker', 'spore-warden', 'zombie-badger', 'demon-badger'],
    portalLink: { id: 'lab-dimension-flank', entry: { gridX: 18, gridY: 10 }, exit: { gridX: 96, gridY: 12 },
      radiusPx: 28, maxBodyRadiusPx: 20, costPx: 192 },
    playerCell: { gridX: 86, gridY: 22 }, spawnArea: { gridX: 0, gridY: 3, widthCells: 8, heightCells: 46 } },
];

export function navigationScenario(id: string): NavigationLabScenario {
  const scenario = NAVIGATION_LAB_SCENARIOS.find(entry => entry.id === id);
  if (!scenario) throw new Error(`Unknown navigation scenario: ${id}`);
  return scenario;
}

export function navigationRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function summarizeNavigationSamples(samples: readonly number[]) {
  const values = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
  return { count: values.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
    max: values[values.length - 1] ?? 0 };
}
