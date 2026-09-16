export const NAVIGATION_SCENARIO_VERSION = 4;
export const NAVIGATION_BENCHMARK_SEEDS = [1, 17, 183, 731, 1337, 8191, 424242, 20260916, 987654321, 20260817] as const;

export interface NavigationLabScenario {
  readonly id: string;
  readonly mapId: string;
  readonly description: string;
  readonly combat: boolean;
  readonly allyFraction: number;
  readonly kinds: readonly string[];
}

export const NAVIGATION_LAB_SCENARIOS: readonly NavigationLabScenario[] = [
  { id: 'rock-field', mapId: '0', description: 'Felsfeld / bestehende Bewegung', combat: false,
    allyFraction: 0, kinds: ['rabid-badger', 'pyro-badger', 'void-stalker', 'alien-badger'] },
  { id: 'siege', mapId: '6', description: 'Basen / Belagerung', combat: true,
    allyFraction: 0, kinds: ['zombie-badger', 'demon-badger', 'spore-warden', 'plague-medic'] },
  { id: 'combat', mapId: '10', description: 'Gemischtes Kampfgeschehen', combat: true,
    allyFraction: 0, kinds: ['rabid-badger', 'pyro-badger', 'alien-badger', 'void-stalker', 'thrower-badger'] },
  { id: 'allies', mapId: '6', description: 'Feinde und Verbuendete', combat: true,
    allyFraction: 0.2, kinds: ['rabid-badger', 'zombie-badger', 'pyro-badger'] },
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
