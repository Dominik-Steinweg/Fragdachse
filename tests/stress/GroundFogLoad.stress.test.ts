import { describe, expect, it } from 'vitest';
import { FogTrailSegments } from '../../src/effects/groundFog/FogTrailSegments';
import { FOG } from '../../src/effects/groundFog/FogConfig';
import weapons from '../../src/loadout/content/data/weapons-ballistic.json';

describe('ground fog sustained multiplayer paths', () => {
  it('retains four triple-P90 streams including repeated direction changes until normal expiry', () => {
    const frame = { offsetX: 0, offsetY: 0, width: 4096, height: 4096 };
    const trails = new FogTrailSegments(frame), vertices = new Float32Array(FOG.trailCapacity * 24);
    const p90 = weapons.weapons.P90;
    const active: { id: number; born: number; x: number; y: number; age: number }[] = [];
    let id = 0, nextShot = 0, peak = 0;
    for (let now = 0; now <= 12000; now += 16) {
      if (now >= nextShot) {
        nextShot = now + p90.cooldown;
        for (let shooter = 0; shooter < 4; shooter++) for (let pellet = 0; pellet < 3; pellet++)
          active.push({ id: ++id, born: now, x: 1200, y: 1200 + shooter * 8 + pellet, age: 0 });
      }
      for (let i = active.length - 1; i >= 0; i--) {
        const shot = active[i], endAge = Math.min(now - shot.born, p90.range / p90.fire.projectileSpeed * 1000);
        // A confirmed pivot every 80ms prevents straight coalescing from hiding load.
        const angle = Math.floor(shot.age / 80) * .18 + shot.id * .03;
        const from = { x: shot.x, y: shot.y, timeMs: shot.born + shot.age, sequence: 1, vx: 0, vy: 0 };
        const distance = (endAge - shot.age) * p90.fire.projectileSpeed / 1000;
        shot.x += Math.cos(angle) * distance; shot.y += Math.sin(angle) * distance;
        trails.addPath({ from, to: { ...from, x: shot.x, y: shot.y, timeMs: shot.born + endAge, sequence: 2 }, ageMs: 0 }, shot.id, now);
        shot.age = endAge;
        if (endAge >= p90.range / p90.fire.projectileSpeed * 1000) active.splice(i, 1);
      }
      trails.prepare(now); peak = Math.max(peak, trails.size);
      expect(trails.dropped).toBe(0);
      expect(trails.writeVertices(vertices, { x: 0, y: 0, width: frame.width, height: frame.height })).toBe(trails.size * 6);
    }
    expect(peak).toBeGreaterThan(1000); expect(peak).toBeLessThan(FOG.trailCapacity);
    trails.prepare(12000 + FOG.trailMs + 1); expect(trails.size).toBe(0);
  });
});
