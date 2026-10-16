import type { WeaponConfigShape } from './LoadoutTypes';

const cache = new WeakMap<WeaponConfigShape, Map<number, WeaponConfigShape>>();
/** Derived equipped-weapon view. Never mutates authored configs or scales utility/ultimate effects. */
export function scaleWeaponRange<T extends WeaponConfigShape>(config: T, factor: number): T {
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0) return config;
  let factors = cache.get(config);
  const cached = factors?.get(factor);
  if (cached) return cached as T;
  const fire = config.fire;
  const scaled = { ...config, range: config.range * factor,
    fire: fire.type === 'tesla_dome'
      ? { ...fire, radius: fire.radius * factor }
      : fire.type === 'energy_shield' ? { ...fire, domeRadius: fire.domeRadius * factor } : fire,
    ...(config.fireballFlameConfig ? { fireballFlameConfig: scaleWeaponRange(config.fireballFlameConfig, factor) } : {}),
  } as T;
  if (!factors) { factors = new Map(); cache.set(config, factors); }
  factors.set(factor, scaled);
  return scaled;
}
