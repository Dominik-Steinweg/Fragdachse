import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { WorldHealthBarRenderer } from '../src/effects/health/WorldHealthBarRenderer';
import { HEALTH_BAR_TUNING, TURRET_HEALTH_BAR_STYLE, enemyHealthBarStyle, baseHealthBarStyle, playerHealthBarStyle } from '../src/effects/health/healthBarStyles';
import { getArenaVisualAttribution } from '../src/scenes/arena/ArenaVisualAttribution';
import { ClarityCameraRegistry } from '../src/scenes/arena/ClarityCameraRegistry';
import { healthBarTestScene } from './healthBarTestScene';

function harness(prewarm = 0, maxFree = 2) {
  const fake = healthBarTestScene();
  let now = 0;
  const renderer = new WorldHealthBarRenderer(fake.scene, () => now, HEALTH_BAR_TUNING,
    { prewarmEnemyViews: prewarm, maxFreeViews: maxFree });
  const scope = {};
  renderer.openWorld(scope);
  return { ...fake, renderer, scope, at(t: number) { now = t; renderer.update(true); } };
}

describe('World HP view ownership', () => {
  it('attributes every consumer profile to its own family exactly once across reuse', () => {
    for (const style of [enemyHealthBarStyle(true, 40), playerHealthBarStyle(false),
      baseHealthBarStyle(80, 0x345678), TURRET_HEALTH_BAR_STYLE]) {
      const h = harness();
      const attribution = getArenaVisualAttribution(h.scene);
      attribution.setActive(true);
      const first = h.renderer.bind(style, 40, 100, 0, 0)!;
      h.at(0);
      expect(attribution.sampleAndReset().graphicsFamilies[style.family])
        .toMatchObject({ objectCount: 3, activeObjects: 2 });
      h.renderer.release(first);
      h.renderer.bind(style, 30, 100, 0, 0);
      h.at(1);
      expect(attribution.sampleAndReset().graphicsFamilies[style.family])
        .toMatchObject({ objectCount: 3, activeObjects: 2 });
      h.renderer.destroy();
      expect(attribution.sampleAndReset().graphicsFamilies[style.family]?.objectCount ?? 0).toBe(0);
    }
  });

  it('does not resurrect a free pooled view when diagnostic suppression ends', () => {
    const h = harness();
    const attribution = getArenaVisualAttribution(h.scene);
    attribution.setActive(true);
    const handle = h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, 0, 0)!;
    h.at(0);
    attribution.setGraphicsFamilySuppressed('enemyStatus', true);
    h.renderer.release(handle);
    attribution.setGraphicsFamilySuppressed('enemyStatus', false);
    h.at(1);
    expect(h.rectangles.every(rect => !rect.visible)).toBe(true);
  });

  it('does not allocate for missing presentation or hidden normal enemies, and initializes the first visible frame', () => {
    const h = harness();
    const handle = h.renderer.bind(enemyHealthBarStyle(false, 40), 70, 100, 80, 90)!;
    h.at(0);
    expect(h.rectangles).toHaveLength(0);
    h.renderer.observe(handle, 35, 100);
    h.at(0);
    const [bg, trail, fill] = h.rectangles;
    expect([bg.x, bg.y, bg.width]).toEqual([80, 90, 40]);
    expect([fill.x, fill.y, fill.width * fill.scaleX, trail.width * trail.scaleX]).toEqual([60, 90, 14, 28]);
    h.renderer.closeWorld(h.scope);
    expect(h.renderer.bind(TURRET_HEALTH_BAR_STYLE, 10, 100, 0, 0)).toBeNull();
    expect(h.renderer.getStats().bindings).toBe(0);
  });

  it('reuses and completely resets views; stale handles cannot mutate the next target', () => {
    const h = harness();
    new ClarityCameraRegistry(h.scene, h.scene.cameras.main, { id: 2 } as never);
    const first = h.renderer.bind(baseHealthBarStyle(80, 0x123456), 50, 100, 10, 20)!;
    h.renderer.alpha(first, 0.4, 0.3);
    h.at(0);
    const [bg, trail, fill] = h.rectangles;
    fill.cameraFilter = 1;
    h.renderer.observe(first, 10, 100);
    h.renderer.release(first);
    const second = h.renderer.bind(baseHealthBarStyle(60, 0x654321), 20, 100, 30, 40)!;
    h.renderer.observe(first, 1, 100);
    h.renderer.position(first, 999, 999);
    h.renderer.release(first);
    h.at(0);
    expect(h.rectangles).toHaveLength(3);
    expect([bg.x, bg.y, bg.width, bg.alpha]).toEqual([30, 40, 60, 1]);
    expect([fill.width * fill.scaleX, trail.width * trail.scaleX, fill.alpha, fill.fillColor]).toEqual([12, 12, 1, 0x654321]);
    expect(fill.cameraFilter).toBe(2);
    expect(trail.visible).toBe(false);
    expect(h.renderer.isValid(second)).toBe(true);
  });

  it('releases zero-HP views but retains the rescuable binding', () => {
    const h = harness();
    const handle = h.renderer.bind(playerHealthBarStyle(false), 100, 100, 0, 0)!;
    h.at(0);
    h.renderer.observe(handle, 0, 100);
    expect(h.renderer.getStats().active).toBe(0);
    expect(h.renderer.isValid(handle)).toBe(true);
    h.renderer.observe(handle, 30, 100);
    h.at(1);
    expect(h.renderer.getStats().active).toBe(1);
    const fill = h.rectangles[2];
    expect(fill.width * fill.scaleX).toBeCloseTo(playerHealthBarStyle(false).width * 0.3);
  });

  it('continues through offscreen movement, discards explicit suppression and ignores duplicate frame time', () => {
    const h = harness();
    const handle = h.renderer.bind(enemyHealthBarStyle(false, 40), 100, 100, 0, 0)!;
    h.renderer.observe(handle, 60, 100);
    h.at(100);
    const trail = h.rectangles[1];
    const width = trail.width * trail.scaleX;
    h.renderer.position(handle, 999999, 999999);
    h.at(100);
    expect(trail.width * trail.scaleX).toBe(width);
    h.at(10_000);
    expect(h.renderer.getStats().active).toBe(0);
    h.renderer.observe(handle, 50, 100);
    h.at(10_000);
    h.renderer.suppress(handle, true);
    h.renderer.observe(handle, 20, 100);
    h.renderer.suppress(handle, false);
    h.at(10_001);
    expect(h.renderer.getStats().active).toBe(0);
  });

  it('bounds free reserve without rejecting active demand and isolates World cleanup', () => {
    const h = harness(2, 2);
    const old = h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, 0, 0)!;
    h.at(0);
    const nextScope = {};
    h.renderer.openWorld(nextScope);
    for (let i = 0; i < 5; i++) h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, i, 0);
    h.at(1);
    expect(h.renderer.getStats().active).toBe(6);
    h.renderer.closeWorld(h.scope);
    h.renderer.observe(old, 0, 100);
    expect(h.renderer.getStats().bindings).toBe(5);
    h.renderer.closeWorld(nextScope);
    expect(h.renderer.getStats()).toMatchObject({ bindings: 0, active: 0, free: 2 });
    h.renderer.destroy();
    expect(h.rectangles.every(rect => !rect.active)).toBe(true);
  });

  it('animates left-anchored HP and trails without rebuilding geometry, including pooled reuse', () => {
    const h = harness();
    const style = baseHealthBarStyle(80, 0x345678);
    const handle = h.renderer.bind(style, 100, 100, 100, 20)!;
    h.at(0);
    const [bg, trail, fill] = h.rectangles;
    const sizes = h.rectangles.map(rect => vi.spyOn(rect, 'setSize'));
    let previousTrailWidth = trail.width * trail.scaleX;
    let trailShrank = false;
    for (let frame = 1; frame <= 40; frame++) {
      const hp = 100 - frame;
      h.renderer.observe(handle, hp, 100);
      h.renderer.position(handle, 100 + frame, 20 + frame);
      h.at(frame * 50);
      const hpWidth = fill.width * fill.scaleX;
      const trailWidth = trail.width * trail.scaleX;
      expect(hpWidth).toBeCloseTo(style.width * hp / 100);
      expect(trailWidth).toBeGreaterThanOrEqual(hpWidth);
      trailShrank ||= trailWidth < previousTrailWidth;
      previousTrailWidth = trailWidth;
      for (const rect of [fill, trail]) {
        expect([rect.width, rect.height, rect.scaleY]).toEqual([style.width, style.height, 1]);
        expect([rect.originX, rect.originY]).toEqual([0, 0.5]);
        expect([rect.x, rect.y]).toEqual([bg.x - style.width / 2, bg.y]);
      }
    }
    expect(trailShrank).toBe(true);
    h.renderer.observe(handle, 75, 100); // Healing cancels the trail without resizing it.
    h.at(2001);
    expect(fill.width * fill.scaleX).toBe(60);
    expect(trail.width * trail.scaleX).toBe(60);
    expect(trail.visible).toBe(false);
    h.renderer.observe(handle, 75, 200); // A silent max-HP change also only changes displayed width.
    h.at(2002);
    expect(fill.width * fill.scaleX).toBe(30);
    for (const size of sizes) expect(size).not.toHaveBeenCalled();

    h.renderer.release(handle);
    const nextStyle = { ...style, width: 60, height: style.height + 2 };
    const next = h.renderer.bind(nextStyle, 100, 100, 200, 30)!;
    h.at(2003);
    expect(h.rectangles).toHaveLength(3);
    for (const rect of [fill, trail]) {
      expect([rect.width, rect.height, rect.scaleX, rect.scaleY]).toEqual([60, nextStyle.height, 1, 1]);
      expect(rect.x).toBe(170);
    }
    for (const size of sizes) size.mockClear(); // Geometry may be initialized when borrowed.
    h.renderer.observe(next, 50, 100);
    h.at(2004);
    expect(fill.width * fill.scaleX).toBe(30);
    h.at(100_000);
    expect(trail.width * trail.scaleX).toBe(30);
    expect(trail.visible).toBe(false);
    for (const size of sizes) expect(size).not.toHaveBeenCalled();
  });

  it('does not rewrite static geometry or settled presentation values', () => {
    const h = harness();
    h.renderer.bind(baseHealthBarStyle(80, 0x345678), 50, 100, 10, 20);
    h.at(0);
    const writes = h.rectangles.map(rect => rect.writes);
    h.at(20);
    expect(h.rectangles.map(rect => rect.writes)).toEqual(writes);
  });

  it('registers physical resources only once and respects diagnostic suppression', () => {
    const h = harness();
    const attribution = getArenaVisualAttribution(h.scene);
    attribution.setActive(true);
    const handle = h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, 0, 0)!;
    h.at(0);
    attribution.setGraphicsFamilySuppressed('enemyStatus', true);
    h.at(1);
    expect(h.rectangles.every(rect => !rect.visible)).toBe(true);
    h.renderer.release(handle);
    h.renderer.bind(enemyHealthBarStyle(true, 40), 40, 100, 0, 0);
    h.at(2);
    expect(h.rectangles).toHaveLength(3);
    expect(h.rectangles.every(rect => !rect.visible)).toBe(true);
    attribution.setGraphicsFamilySuppressed('enemyStatus', false);
    h.at(3);
    expect(h.rectangles[2].visible).toBe(true);
  });
});
