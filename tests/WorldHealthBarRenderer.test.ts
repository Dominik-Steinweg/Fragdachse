import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { WorldHealthBarRenderer } from '../src/effects/health/WorldHealthBarRenderer';
import { HEALTH_BAR_BACKING, HEALTH_BAR_TUNING, TURRET_HEALTH_BAR_STYLE, enemyHealthBarStyle, baseHealthBarStyle,
  playerHealthBarStyle } from '../src/effects/health/healthBarStyles';
import { getArenaVisualAttribution } from '../src/scenes/arena/ArenaVisualAttribution';
import { ClarityCameraRegistry } from '../src/scenes/arena/ClarityCameraRegistry';
import { drawnHealthBars, healthBarTestScene } from './healthBarTestScene';

function harness() {
  const fake = healthBarTestScene();
  let now = 0;
  const renderer = new WorldHealthBarRenderer(fake.scene, () => now, HEALTH_BAR_TUNING);
  const scope = {};
  renderer.openWorld(scope);
  return { ...fake, renderer, scope, bars: () => drawnHealthBars(renderer), at(t: number) { now = t; renderer.update(true); } };
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
      // One GPU layer per family, however many bars it draws.
      expect(attribution.sampleAndReset().graphicsFamilies[style.family])
        .toMatchObject({ objectCount: 1, activeObjects: 1 });
      h.renderer.release(first);
      h.renderer.bind(style, 30, 100, 0, 0);
      h.renderer.bind(style, 20, 100, 50, 0);
      h.at(1);
      expect(attribution.sampleAndReset().graphicsFamilies[style.family])
        .toMatchObject({ objectCount: 1, activeObjects: 1 });
      expect(h.bars()).toHaveLength(2);
      h.renderer.destroy();
      expect(attribution.sampleAndReset().graphicsFamilies[style.family]?.objectCount ?? 0).toBe(0);
    }
  });

  it('does not resurrect a released bar when diagnostic suppression ends', () => {
    const h = harness();
    const attribution = getArenaVisualAttribution(h.scene);
    attribution.setActive(true);
    const handle = h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, 0, 0)!;
    h.at(0);
    attribution.setGraphicsFamilySuppressed('enemyStatus', true);
    h.renderer.release(handle);
    attribution.setGraphicsFamilySuppressed('enemyStatus', false);
    h.at(1);
    expect(h.bars()).toHaveLength(0);
    expect(h.cosmetic.every(image => !image.visible)).toBe(true);
  });

  it('does not allocate for missing presentation or hidden normal enemies, and initializes the first visible frame', () => {
    const h = harness();
    const handle = h.renderer.bind(enemyHealthBarStyle(false, 40), 70, 100, 80, 90)!;
    h.at(0);
    expect(h.cosmetic).toHaveLength(0);
    h.renderer.observe(handle, 35, 100);
    h.at(0);
    expect(h.bars()).toEqual([expect.objectContaining({ x: 80, y: 90, width: 40, left: 60, hpWidth: 14, trailWidth: 28 })]);
    h.renderer.closeWorld(h.scope);
    expect(h.renderer.bind(TURRET_HEALTH_BAR_STYLE, 10, 100, 0, 0)).toBeNull();
    expect(h.renderer.getStats().bindings).toBe(0);
  });

  it('reuses layer instances with completely reset values; stale handles cannot mutate the next target', () => {
    const h = harness();
    new ClarityCameraRegistry(h.scene, h.scene.cameras.main, { id: 2 } as never);
    const first = h.renderer.bind(baseHealthBarStyle(80, 0x123456), 50, 100, 10, 20)!;
    h.renderer.alpha(first, 0.4, 0.3);
    h.at(0);
    expect(h.bars()[0]).toMatchObject({ alpha: 0.4, border: true });
    expect(h.bars()[0].backingAlpha).toBeCloseTo(HEALTH_BAR_BACKING.alpha * 0.3, 2);
    h.renderer.observe(first, 10, 100);
    h.renderer.release(first);
    const second = h.renderer.bind(baseHealthBarStyle(60, 0x654321), 20, 100, 30, 40)!;
    h.renderer.observe(first, 1, 100);
    h.renderer.position(first, 999, 999);
    h.renderer.release(first);
    h.at(0);
    expect(h.cosmetic).toHaveLength(1);
    // World presentation: only the World camera draws the layer (the Clarity id is filtered).
    expect(h.cosmetic[0].cameraFilter).toBe(2);
    const [bar] = h.bars();
    expect([bar.x, bar.y, bar.width, bar.alpha, bar.hpWidth, bar.trailWidth, bar.color]).toEqual([30, 40, 60, 1, 12, 12, 0x654321]);
    expect(bar.backingAlpha).toBeCloseTo(HEALTH_BAR_BACKING.alpha, 2);
    expect(bar.trailVisible).toBe(false);
    expect(h.renderer.isValid(second)).toBe(true);
  });

  it('releases zero-HP bars but retains the rescuable binding', () => {
    const h = harness();
    const handle = h.renderer.bind(playerHealthBarStyle(false), 100, 100, 0, 0)!;
    h.at(0);
    h.renderer.observe(handle, 0, 100);
    expect(h.renderer.getStats().active).toBe(0);
    expect(h.renderer.isValid(handle)).toBe(true);
    h.renderer.observe(handle, 30, 100);
    h.at(1);
    expect(h.renderer.getStats().active).toBe(1);
    expect(h.bars()[0].hpWidth).toBeCloseTo(playerHealthBarStyle(false).width * 0.3);
  });

  it('continues through offscreen movement, discards explicit suppression and ignores duplicate frame time', () => {
    const h = harness();
    const handle = h.renderer.bind(enemyHealthBarStyle(false, 40), 100, 100, 0, 0)!;
    h.renderer.observe(handle, 60, 100);
    h.at(100);
    const width = h.bars()[0].trailWidth;
    h.renderer.position(handle, 999999, 999999);
    h.at(100);
    expect(h.bars()[0].trailWidth).toBe(width);
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

  it('never rejects active demand and isolates World cleanup', () => {
    const h = harness();
    const old = h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, 0, 0)!;
    h.at(0);
    const nextScope = {};
    h.renderer.openWorld(nextScope);
    for (let i = 0; i < 5; i++) h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, i, 0);
    h.at(1);
    expect(h.renderer.getStats()).toMatchObject({ active: 6, drawn: 6, layers: 1 });
    h.renderer.closeWorld(h.scope);
    h.renderer.observe(old, 0, 100);
    expect(h.renderer.getStats().bindings).toBe(5);
    h.renderer.closeWorld(nextScope);
    h.at(2);
    expect(h.renderer.getStats()).toMatchObject({ bindings: 0, active: 0, drawn: 0 });
    expect(h.bars()).toHaveLength(0);
    h.renderer.destroy();
    expect(h.cosmetic.every(image => !image.active)).toBe(true);
  });

  it('animates left-anchored HP and trails, including reuse with new geometry', () => {
    const h = harness();
    const style = baseHealthBarStyle(80, 0x345678);
    const handle = h.renderer.bind(style, 100, 100, 100, 20)!;
    h.at(0);
    let previousTrailWidth = h.bars()[0].trailWidth;
    let trailShrank = false;
    for (let frame = 1; frame <= 40; frame++) {
      const hp = 100 - frame;
      h.renderer.observe(handle, hp, 100);
      h.renderer.position(handle, 100 + frame, 20 + frame);
      h.at(frame * 50);
      const [bar] = h.bars();
      expect(bar.hpWidth).toBeCloseTo(style.width * hp / 100);
      expect(bar.trailWidth).toBeGreaterThanOrEqual(bar.hpWidth);
      trailShrank ||= bar.trailWidth < previousTrailWidth;
      previousTrailWidth = bar.trailWidth;
      expect([bar.width, bar.height, bar.left, bar.y]).toEqual([style.width, style.height, 100 + frame - style.width / 2, 20 + frame]);
    }
    expect(trailShrank).toBe(true);
    h.renderer.observe(handle, 75, 100); // Healing cancels the trail.
    h.at(2001);
    expect(h.bars()[0]).toMatchObject({ hpWidth: 60, trailWidth: 60, trailVisible: false });
    h.renderer.observe(handle, 75, 200); // A silent max-HP change only changes displayed width.
    h.at(2002);
    expect(h.bars()[0].hpWidth).toBe(30);

    h.renderer.release(handle);
    const nextStyle = { ...style, width: 60, height: style.height + 2 };
    const next = h.renderer.bind(nextStyle, 100, 100, 200, 30)!;
    h.at(2003);
    expect(h.bars()).toEqual([expect.objectContaining({ width: 60, height: nextStyle.height, left: 170, hpWidth: 60 })]);
    h.renderer.observe(next, 50, 100);
    h.at(2004);
    expect(h.bars()[0].hpWidth).toBe(30);
    h.at(100_000);
    expect(h.bars()[0]).toMatchObject({ trailWidth: 30, trailVisible: false });
    expect(h.cosmetic).toHaveLength(1);
  });

  it('emits identical bar data for settled frames', () => {
    const h = harness();
    h.renderer.bind(baseHealthBarStyle(80, 0x345678), 50, 100, 10, 20);
    h.at(0);
    const first = h.bars();
    h.at(20);
    expect(h.bars()).toEqual(first);
  });

  it('registers its layer only once and respects diagnostic suppression', () => {
    const h = harness();
    const attribution = getArenaVisualAttribution(h.scene);
    attribution.setActive(true);
    const handle = h.renderer.bind(enemyHealthBarStyle(true, 40), 100, 100, 0, 0)!;
    h.at(0);
    attribution.setGraphicsFamilySuppressed('enemyStatus', true);
    h.at(1);
    expect(h.cosmetic.every(image => !image.visible)).toBe(true);
    h.renderer.release(handle);
    h.renderer.bind(enemyHealthBarStyle(true, 40), 40, 100, 0, 0);
    h.at(2);
    expect(h.cosmetic).toHaveLength(1);
    expect(h.cosmetic.every(image => !image.visible)).toBe(true);
    attribution.setGraphicsFamilySuppressed('enemyStatus', false);
    h.at(3);
    expect(h.cosmetic[0].visible).toBe(true);
    expect(h.bars()).toHaveLength(1);
  });

  it('keeps each family in its own depth layer', () => {
    const h = harness();
    h.renderer.bind(enemyHealthBarStyle(true, 40), 50, 100, 0, 0);
    h.renderer.bind(playerHealthBarStyle(false), 50, 100, 0, 0);
    h.renderer.bind(baseHealthBarStyle(80, 0x345678), 50, 100, 0, 0);
    h.at(0);
    const layers = h.renderer.getLayers();
    expect(layers.map(layer => [layer.family, layer.drawDepth])).toEqual([
      ['enemyStatus', enemyHealthBarStyle(true, 40).fillDepth],
      ['playerStatus', playerHealthBarStyle(false).fillDepth],
      ['baseMarkers', baseHealthBarStyle(80, 0).fillDepth],
    ]);
    expect(h.cosmetic.map(image => image.depth)).toEqual(layers.map(layer => layer.drawDepth));
  });
});
