import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Scenes: { Events: { SHUTDOWN: 'shutdown' } } }));
import { MarkerGpuRenderer } from '../src/effects/markers/MarkerGpuRenderer';

describe('marker renderer presentation lifetime', () => {
  it.each([false, true])('allocates no GPU, texture, text or loading resources for none/headless (%s)', none => {
    const scene = { sys: { renderer: none ? { gl: {} } : {} }, cameras: { main: {} },
      add: { image: vi.fn(), text: vi.fn() }, textures: { exists: vi.fn() }, events: { off: vi.fn() } };
    const renderer = new MarkerGpuRenderer(scene as never, { presentation: none ? 'none' : 'interactive' });
    renderer.sync({ worldBadges: [], edgeBadges: [], groundRings: [] }, 100, false);
    expect(renderer.getDiagnostics()).toMatchObject({ draws: 0, labels: 0, atlas: null });
    expect(scene.add.image).not.toHaveBeenCalled(); expect(scene.textures.exists).not.toHaveBeenCalled();
    renderer.destroy(); renderer.destroy();
  });
});
