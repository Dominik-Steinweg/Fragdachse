import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 1 } },
}));

vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityProfile: () => ({
    localDistortion: true,
    distortionMapScale: 0.25,
    maxDistortionSources: 6,
  }),
}));

vi.mock('../src/ui/HostileBaseIndicator', () => ({
  getVisibleWorldView: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
}));

import { LocalDistortionComposer } from '../src/effects/distortion/LocalDistortionComposer';
import { DISTORTION_PRIORITY } from '../src/effects/distortion/distortionFramePlanner';

function makeComposer() {
  const calls: string[] = [];
  const texture = {
    setFilter: () => { calls.push('setFilter'); },
    fill: () => { calls.push('fill'); },
    stamp: () => { calls.push('stamp'); },
    render: () => { calls.push('render'); },
  };
  const scene = {
    textures: {
      // Die vier Profiltexturen gelten als bereits gebacken; geprüft wird nur die Frame-Karte.
      exists: () => true,
      addDynamicTexture: () => texture,
      remove: () => undefined,
    },
  } as never;

  return { composer: new LocalDistortionComposer(scene), calls };
}

describe('LocalDistortionComposer', () => {
  it('flusht Neutralfüllung und lokale Stempel in die GPU-Textur', () => {
    const { composer, calls } = makeComposer();
    composer.submit({
      id: 'bubble:1',
      profile: 'lens',
      worldX: 960,
      worldY: 540,
      radiusPx: 200,
      strength: 1,
      priority: DISTORTION_PRIORITY.timeBubble,
    });

    const plan = composer.update({} as never);

    expect(plan.commands).toHaveLength(1);
    expect(calls).toEqual([
      'setFilter',
      'fill',
      'render',
      'fill',
      'stamp',
      'render',
    ]);
  });

  it('flusht beim Reset wieder eine neutrale Karte', () => {
    const { composer, calls } = makeComposer();
    composer.update({} as never);
    calls.length = 0;

    composer.reset();

    expect(calls).toEqual(['fill', 'render']);
  });
});
