import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0 },
}));

import { PersistentGpuWorldSystem } from '../src/arena/rocks/PersistentGpuWorldSystem';
import { RockVisualStateStore, resolveRockCornerTints } from '../src/arena/rocks/RockVisualState';
import type { RockVisualState } from '../src/arena/rocks/RockVisualState';

class FakeGpuLayer {
  readonly members: object[] = [];
  readonly edits: Array<{ slot: number; member: object }> = [];
  readonly bufferUpdateSegmentSize: number;
  visible = true;
  fullUpload = false;

  constructor(readonly size: number) {
    this.bufferUpdateSegmentSize = Math.ceil(size / 24);
  }

  setDepth(): this { return this; }
  setBlendMode(): this { return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  addMember(member: object): this { this.members.push(member); return this; }
  editMember(slot: number, member: object): this {
    this.members[slot] = member;
    this.edits.push({ slot, member });
    return this;
  }
  setAllSegmentsNeedUpdate(): void { this.fullUpload = true; }
  getDataByteSize(): number { return 42 * 4; }
  destroy(): void {}
}

function state(id: number, gridX: number, gridY: number): RockVisualState {
  return {
    id,
    gridX,
    gridY,
    x: gridX * 32 + 16,
    y: gridY * 32 + 16,
    active: true,
    frame: id % 47,
    cornerTints: [0xffffff, 0xf0f0f0, 0xe0e0e0, 0xd0d0d0],
    damageTint: 0xffffff,
    ownerTintStrength: 0,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
  };
}

function fixture(states: RockVisualState[], width = 1024, height = 512) {
  const layers: FakeGpuLayer[] = [];
  const texture = { get: (frame: number) => ({ name: String(frame), width: 32, height: 32 }) };
  const scene = {
    textures: { get: () => texture },
    add: {
      spriteGPULayer: (_texture: unknown, size: number) => {
        const layer = new FakeGpuLayer(size);
        layers.push(layer);
        return layer;
      },
    },
  };
  const system = new PersistentGpuWorldSystem(
    scene as never,
    { offsetX: 0, offsetY: 0, width, height },
    states,
    512,
  );
  return { system, layers };
}

describe('PersistentGpuWorldSystem', () => {
  it('keeps a grid cell on the same deterministic page slot across destroy and rebuild', () => {
    const rock = state(0, 3, 5);
    const { system, layers } = fixture([rock]);

    rock.active = false;
    system.applyDirty([0]);
    rock.active = true;
    rock.frame = 31;
    system.applyDirty([0]);

    expect(layers[0].edits.map((edit) => edit.slot)).toEqual([5 * 16 + 3, 5 * 16 + 3]);
    expect(system.getDiagnostics().affectedPages).toBe(2);
  });

  it('switches from sparse segment patches to a full page upload at the simple threshold', () => {
    const rocks = Array.from({ length: 12 }, (_, segment) => {
      const slot = segment * 11;
      return state(segment, slot % 16, Math.floor(slot / 16));
    });
    const { system, layers } = fixture(rocks);

    system.applyDirty(rocks.map((rock) => rock.id));

    const diagnostics = system.getDiagnostics();
    expect(diagnostics.dirtyBufferSegments).toBe(12);
    expect(diagnostics.fullUploads).toBe(1);
    expect(diagnostics.sparseUploads).toBe(0);
    expect(layers[0].fullUpload).toBe(true);
  });

  it('only toggles fixed pages as the prefetched camera range moves', () => {
    const { system, layers } = fixture([]);
    expect(layers).toHaveLength(2);

    system.updateVisibility({ x: 0, y: 0, width: 100, height: 100 });
    expect(layers.map((layer) => layer.visible)).toEqual([true, false]);

    system.updateVisibility({ x: 900, y: 0, width: 100, height: 100 });
    expect(layers.map((layer) => layer.visible)).toEqual([false, true]);
  });
});

describe('RockVisualStateStore', () => {
  it('deduplicates repeated changes and composes damage, owner and four surface tints once', () => {
    const store = new RockVisualStateStore();
    const rock = state(4, 0, 0);
    store.add(rock, false);
    store.patch(4, { damageTint: 0x808080, ownerColor: 0xff0000, ownerTintStrength: 0.5 });
    store.markDirty(4);
    store.markDirty(4);

    expect(store.consumeDirtyIds()).toEqual([4]);
    const tints = resolveRockCornerTints(rock);
    expect(tints).toHaveLength(4);
    expect(new Set(tints).size).toBe(4);
  });
});
