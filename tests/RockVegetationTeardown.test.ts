import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Der Aufraeumpfad ruft davon nichts auf; die Attrappe stellt
// nur so viel bereit, dass die Modulkette von `ArenaBuilder` importierbar bleibt.
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 1, ADD: 2, ERASE: 17 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Between: (min: number) => min,
    RND: { pick: <T>(items: readonly T[]) => items[0] },
  },
  Geom: { Rectangle: class {} },
  GameObjects: { Image: class {} },
}));

import { ArenaBuilder } from '../src/arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';

/**
 * Aufraeumen der rundengebundenen Fels-Overlays.
 *
 * Die Vegetationsschicht haelt vier langlebige RenderTextures (Layer, Stanzform und die beiden
 * Chunk-Scratches) plus ein Image auf der Stanzform. Alle fuenf sind arenagross oder haengen an
 * einer Textur und ueberleben jede Zerstoerungswelle – genau deshalb muessen sie am Rundenende
 * fallen. Ein vergessener Layer waere kein sichtbarer Fehler, sondern eine wachsende Zahl toter
 * Texturen ueber die Rundengrenzen hinweg.
 *
 * Der Test faehrt bewusst ohne Phaser-Scene: `destroyDynamic` ruft auf allen Beteiligten nur
 * `destroy()` und liest `active`, ein Attrappenobjekt genuegt also und macht sichtbar, welche
 * Felder ueberhaupt aufgeraeumt werden.
 */

interface Disposable {
  active: boolean;
  destroyed: number;
  destroy(): void;
}

function disposable(): Disposable {
  return {
    active: true,
    destroyed: 0,
    destroy() {
      this.destroyed += 1;
      this.active = false;
    },
  };
}

function buildResult() {
  const parts = {
    rockVegetationLayer: disposable(),
    rockVegetationCutout: disposable(),
    rockMossLayer: disposable(),
    rockMossCutout: disposable(),
    scratchVegetation: disposable(),
    scratchVegetationCutout: disposable(),
    scratchVegetationCutoutImage: disposable(),
    scratchMoss: disposable(),
  };

  const result = {
    baseZoneObjects: [],
    rockGroup: { destroy() {} },
    rockObjects: [],
    rockStateTints: [],
    trunkGroup: { destroy() {} },
    trunkObjects: [],
    canopyObjects: [],
    trackObjects: [],
    dirtLayer: null,
    dirtStamps: [],
    groundCoverLayer: null,
    groundCoverStamps: [],
    decalLayer: null,
    decalStamps: [],
    rockDecalLayer: null,
    rockMossLayer: parts.rockMossLayer,
    rockMossCutout: parts.rockMossCutout,
    rockMossPlacements: [{ textureKey: 'rock_moss_01' }],
    rockVegetationLayer: parts.rockVegetationLayer,
    rockVegetationCutout: parts.rockVegetationCutout,
    rockVegetationPlacements: [{ textureKey: 'rock_veg_01_large' }],
    rockMottleLayers: [],
    rockSilhouetteCutout: null,
    rockOverlayScratch: {
      cutout: disposable(),
      cutoutImage: disposable(),
      mottleLayers: [],
      decal: disposable(),
      moss: parts.scratchMoss,
      mossCutout: disposable(),
      mossCutoutImage: disposable(),
      vegetation: parts.scratchVegetation,
      vegetationCutout: parts.scratchVegetationCutout,
      vegetationCutoutImage: parts.scratchVegetationCutoutImage,
    },
  } as unknown as ArenaBuilderResult;

  return { result, parts };
}

describe('Rock vegetation teardown', () => {
  it('destroys layer, cutout and chunk scratches and clears the placements', () => {
    const { result, parts } = buildResult();

    ArenaBuilder.destroyDynamic(result);

    expect(parts.rockVegetationLayer.destroyed).toBe(1);
    expect(parts.rockVegetationCutout.destroyed).toBe(1);
    expect(parts.scratchVegetation.destroyed).toBe(1);
    expect(parts.scratchVegetationCutout.destroyed).toBe(1);
    expect(parts.scratchVegetationCutoutImage.destroyed).toBe(1);

    expect(result.rockVegetationLayer).toBeNull();
    expect(result.rockVegetationCutout).toBeNull();
    expect(result.rockVegetationPlacements).toHaveLength(0);
    expect(result.rockOverlayScratch).toBeNull();

    // Die Nachbarschicht darf dabei nicht verloren gehen: beide teilen sich denselben Trichter.
    expect(parts.rockMossLayer.destroyed).toBe(1);
    expect(parts.rockMossCutout.destroyed).toBe(1);
    expect(parts.scratchMoss.destroyed).toBe(1);
    expect(result.rockMossPlacements).toHaveLength(0);
  });

  it('is safe to run twice', () => {
    const { result, parts } = buildResult();

    ArenaBuilder.destroyDynamic(result);
    ArenaBuilder.destroyDynamic(result);

    expect(parts.rockVegetationLayer.destroyed).toBe(1);
    expect(parts.scratchVegetation.destroyed).toBe(1);
  });
});
