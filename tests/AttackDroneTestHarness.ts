import { ATTACK_DRONE_RULES as R, resolveAttackDroneStats } from '../src/config/attackDrone';
import { AttackDroneSystem, type AttackDroneAttack, type AttackDroneStation } from '../src/systems/AttackDroneSystem';
import type { AttackDroneTarget } from '../src/systems/AttackDroneTargeting';

export function droneHarness(levels: Record<string, number> = {}) {
  const stats = resolveAttackDroneStats(key => levels[key.split('.').at(-1)!] ?? 0);
  const stations: AttackDroneStation[] = [{ id: 1, ownerId: 'owner', ownerColor: 0xaabbcc, x: 2000, y: 2000, stats }];
  const owner = { x: 2000, y: 2000, available: true, alive: true };
  const targets: AttackDroneTarget[] = [{ key: 'target', x: 2100, y: 2000, radius: 20, weight: 1 }];
  const shots: (AttackDroneAttack & { angle: number })[] = [], bombs: AttackDroneAttack[] = [];
  let targetReads = 0, now = 0;
  const system = new AttackDroneSystem({ bounds: { left: 0, top: 0, right: 12000, bottom: 12000 },
    stations: () => stations, owner: () => owner,
    targets: () => { targetReads++; return targets; }, readTarget: key => targets.find(t => t.key === key) ?? null,
    canTarget: () => true, fire: shot => shots.push(shot), dropBomb: bomb => bombs.push(bomb) });
  return { system, stations, owner, targets, shots, bombs, stats,
    get now() { return now; }, get targetReads() { return targetReads; },
    tick(dt = 25) { now += dt; system.update(now, dt); },
    run(ms: number, dt = 25) { const end = now + ms; do { const step = Math.min(dt, end - now); now += step; system.update(now, step); } while (now < end); },
    reset() { system.clear(); now = 0; shots.length = 0; bombs.length = 0; },
  };
}
export function droneGroup(x = 2100, y = 2000): AttackDroneTarget[] {
  return Array.from({length: R.bombGroupThreshold}, (_, i) => ({ key: `group-${i}`, x: x + i * 50, y, radius: 20, weight: 1 }));
}
