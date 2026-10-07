import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/effects/FireSystem', () => ({ GROUND_FIRE_CELL_SIZE: 16 }));
vi.mock('../src/effects/FlameShared', () => ({ TEX_VOID_FLAME_GLOW: 'void-glow' }));

import { GroundHazardWarningRenderer } from '../src/effects/GroundHazardWarningRenderer';

describe('Ground hazard warning display lifetime', () => {
  it('detaches retired warnings, reuses them for the next band and destroys the whole pool on clear', () => {
    const displayed = new Set<Image>();
    const allocated: Image[] = [];
    class Image {
      visible = true;
      destroyed = false;
      setBlendMode() { return this; }
      setDepth() { return this; }
      setTint() { return this; }
      setPosition() { return this; }
      setDisplaySize() { return this; }
      setAlpha() { return this; }
      setVisible(visible: boolean) { this.visible = visible; return this; }
      addToDisplayList() { displayed.add(this); return this; }
      removeFromDisplayList() { displayed.delete(this); return this; }
      destroy() { this.removeFromDisplayList(); this.destroyed = true; }
    }
    const scene = { add: { image: () => {
      const image = new Image(); allocated.push(image); return image.addToDisplayList();
    } } };
    const renderer = new GroundHazardWarningRenderer(scene as never);
    const band = Array.from({ length: 12 }, (_, gridX) => ({ gridX, gridY: 0, activatesAt: 1000 }));
    renderer.sync(band, 0);
    expect(displayed.size).toBe(band.length);
    renderer.sync(band.slice(0, 3), 10);
    expect(displayed.size).toBe(3);
    renderer.sync(band, 1000);
    expect(displayed.size).toBe(0);
    renderer.sync(undefined, 1100);
    renderer.sync(band.map(cell => ({ ...cell, activatesAt: 3000 })), 1200);
    expect(displayed.size).toBe(band.length);
    expect(allocated).toHaveLength(band.length);
    expect([...displayed].every(image => image.visible && !image.destroyed)).toBe(true);
    renderer.clear();
    expect(displayed.size).toBe(0);
    expect(allocated.every(image => image.destroyed)).toBe(true);
    renderer.sync(band, 0);
    expect(displayed.size).toBe(band.length);
    expect([...displayed].every(image => !image.destroyed)).toBe(true);
  });
});
