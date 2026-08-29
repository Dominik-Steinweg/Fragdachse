import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapPersistentBasePreview,
} from '../src/config/coopDefenseMaps';
import rawMap from '../src/config/coopDefenseMaps/01-feuertaufe.json';
import type { CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { toAuthoredScenario, toCoopDefenseMapConfig } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA, resolvePersistentBaseCoreCells } from '../src/persistentBase/PersistentBaseCore';
import { getAuthoredWorldMetricsProfile } from '../src/config';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';
import { PersistentBasePreviewRenderer } from '../src/scenes/arena/PersistentBasePreviewRenderer';
import { createFakeArenaScene } from './fakeArenaRenderScene';

describe('Persistent-Base-Vorschau – Map 1 Authoring', () => {
  it('löst die Vorschau am finalen Checkpoint in den sauberen Standardzustand auf', () => {
    const map = getCoopDefenseMapConfig('1');
    const preview = resolveCoopDefenseMapPersistentBasePreview(map);

    expect(map.persistentBasePreview).toEqual({ checkpointId: 'final-extraction' });
    expect(map.persistentBase).toBeUndefined();
    expect(preview).toEqual({
      checkpointId: 'final-extraction',
      anchor: { gridX: 248, gridY: 14 },
      orientation: 'open-left',
      buildArea: DEFAULT_PERSISTENT_BASE_BUILD_AREA,
    });
  });

  it('weist unbekannte Checkpoints und Ausrichtungen an der Authoring-Grenze zurück', () => {
    const map = getCoopDefenseMapConfig('1');
    expect(() => normalizeCoopDefenseMapConfig({
      ...rawMap,
      persistentBasePreview: { checkpointId: 'does-not-exist' },
    } as unknown as CoopDefenseMapConfig)).toThrow(/unknown checkpoint/);
    expect(() => normalizeCoopDefenseMapConfig({
      ...rawMap,
      persistentBasePreview: { checkpointId: 'final-extraction', orientation: 'diagonal' as never },
    } as unknown as CoopDefenseMapConfig)).toThrow(/unknown orientation/);
  });

  it('transportiert die Vorschau als Activity und nicht als World-Inhalt', () => {
    const map = getCoopDefenseMapConfig('1');
    const scenario = toAuthoredScenario(map);

    expect(scenario.world.persistentBaseSite).toBeUndefined();
    expect(scenario.activity?.persistentBasePreview).toEqual({ checkpointId: 'final-extraction' });
    expect(toCoopDefenseMapConfig(scenario)).toEqual(map);
  });
});

describe('Persistent-Base-Vorschau – Presentation', () => {
  it('verwendet exakt den kanonischen Kern und neun 3x3-Baubereichszellen', () => {
    const preview = resolveCoopDefenseMapPersistentBasePreview(getCoopDefenseMapConfig('1'))!;
    const core = resolvePersistentBaseCoreCells(preview.anchor, preview.orientation);

    expect(core.filter((cell) => cell.domain === 'base-surface')).toHaveLength(12);
    expect(core.filter((cell) => cell.domain === 'courtyard-build-area')).toHaveLength(9);
    expect(preview.buildArea).toEqual({ kind: 'square', sizeCells: 3 });
  });

  it('rendert zwölf blaue Basisbilder ohne aktive Basis-Entity und hält die Basislichter am Leben', () => {
    const scene = createFakeArenaScene();
    const images: Array<{ key: string; active: boolean }> = [];
    const originalImage = scene.add.image;
    scene.add.image = ((x: number, y: number, key: string) => {
      const image = originalImage(x, y, key);
      images.push(image);
      return image;
    }) as typeof originalImage;
    const lighting = {
      setLight: vi.fn(),
      releaseLight: vi.fn(),
    };
    const renderer = new PersistentBasePreviewRenderer(
      scene as never,
      lighting as never,
    );
    const preview = resolveCoopDefenseMapPersistentBasePreview(getCoopDefenseMapConfig('1'))!;
    const metrics = resolveWorldMetrics(getAuthoredWorldMetricsProfile(260, 33));

    renderer.sync(preview, metrics);
    expect(images).toHaveLength(12);
    expect(images.every((image) => image.key === 'base')).toBe(true);

    renderer.syncLights(true);
    expect(lighting.setLight).toHaveBeenCalled();
    renderer.clear();
    expect(images.every((image) => image.active === false)).toBe(true);
    expect(lighting.releaseLight).toHaveBeenCalled();
  });
});
