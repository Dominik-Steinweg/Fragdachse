import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0 },
}));

import { PersistentGpuWorldSystem } from '../src/arena/rocks/PersistentGpuWorldSystem';
import { updateRockLightingSun, type RockLightingState } from '../src/arena/rocks/RockLightingState';
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
  setTexture = vi.fn((_key: string) => this);
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

function fixture(states: RockVisualState[], width = 1024, height = 512, mineralScale = 1) {
  const layers: FakeGpuLayer[] = [];
  const textures = (key: string) => ({ source: [{ width: 2176 * (key === 'woodland-rock-colour' ? mineralScale : 1), height: 1870 * (key === 'woodland-rock-colour' ? mineralScale : 1) }], get: (frame: number) => ({ name: String(frame), textureKey: key, width: 32, height: 32 }) });
  const scene = {
    textures: { get: textures },
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
  it('normalizes a doubled atlas against the original frame table without changing slots, walls or world sizes', () => {
    const {system,layers}=fixture([state(0,3,5),{...state(1,4,5),material:'walls'}],512,512,2);
    const uniforms=new Map<string,unknown>();
    const setUniform=vi.fn((key:string,value:unknown)=>uniforms.set(key,value));
    const node={programManager:{setUniform},setupUniforms(){
      const scale=layers[0].setTexture.mock.calls.at(-1)?.[0]==='woodland-rock-colour'?2:1;
      this.programManager.setUniform('uDiffuseResolution',[2176*scale,1870*scale]);
      this.programManager.setUniform('uMainResolution',[2176*scale,1870*scale]);
    }};
    Object.assign(layers[0],{submitterNode:node});
    const materialState:RockLightingState={enabled:true,normals:false,material:'mineral',colourTextureKey:'test-mineral-1x',strength:1,sun:[0,0,1]};
    const originalSetup=node.setupUniforms;
    system.setMaterialLighting(materialState);
    expect(node.setupUniforms).toBe(originalSetup);
    const members=structuredClone(layers[0].members),edits=layers[0].edits.length,uploads=system.getDiagnostics().estimatedUploadBytes;
    materialState.colourTextureKey='woodland-rock-colour';system.setMaterialLighting(materialState);
    const setup=node.setupUniforms;node.setupUniforms();
    expect(uniforms.get('uDiffuseResolution')).toEqual([2176,1870]);
    expect(uniforms.get('uMainResolution')).toEqual([4352,3740]);
    // Authored frames retain exactly the same normalized corners and 32px quads.
    for(const [column,row] of [[0,0],[12,8],[63,54]])for(const edge of [0,32]){
      const x=1+column*34+edge,y=1+row*34+edge;
      expect(x/2176).toBe((x*2)/4352);expect(y/1870).toBe((y*2)/3740);
    }
    system.setMaterialLighting(materialState);expect(node.setupUniforms).toBe(setup);
    expect(layers[0].members).toEqual(members);expect(layers[0].edits).toHaveLength(edits);
    expect(system.getDiagnostics().estimatedUploadBytes).toBe(uploads);
    expect(layers.at(-1)!.setTexture).not.toHaveBeenCalled();
    for(let cycle=0;cycle<4;cycle++)for(const scale of [1,2]){
      materialState.colourTextureKey=scale===2?'woodland-rock-colour':'test-mineral-1x';
      system.setMaterialLighting(materialState);setUniform.mockClear();node.setupUniforms();
      expect(node.setupUniforms).toBe(setup);
      expect(uniforms.get('uDiffuseResolution')).toEqual([2176,1870]);
      expect(uniforms.get('uMainResolution')).toEqual([2176*scale,1870*scale]);
      expect(setUniform).toHaveBeenCalledTimes(scale===2?3:2);
      expect(layers[0].members).toEqual(members);expect(layers[0].edits).toHaveLength(edits);
      expect(system.getDiagnostics().estimatedUploadBytes).toBe(uploads);
    }
    materialState.material='original';materialState.enabled=false;system.setMaterialLighting(materialState);
    setUniform.mockClear();node.setupUniforms();
    expect(uniforms.get('uDiffuseResolution')).toEqual([2176,1870]);expect(setUniform).toHaveBeenCalledTimes(2);
    expect(layers.at(-1)!.setTexture).not.toHaveBeenCalled();
  });

  it('releases rock and wall GPU resources across repeated world lifetimes without deleting shared programs', () => {
    const sharedProgram = { destroy: vi.fn() };
    const unrelatedVao = { destroy: vi.fn() };
    const renderer = { glVAOWrappers: [unrelatedVao], deleteBuffer: vi.fn() };
    for (let cycle = 0; cycle < 3; cycle++) {
      const { system, layers } = fixture([state(0, 3, 5), { ...state(1, 4, 5), material: 'walls' }]);
      const owned = layers.map(layer => {
        const vao = { destroy: vi.fn() };
        const instance = {}, vertex = {};
        const destroy = vi.spyOn(layer, 'destroy');
        renderer.glVAOWrappers.push(vao);
        Object.assign(layer, { submitterNode: {
          manager: { renderer },
          programManager: { programs: { main: { vao, program: sharedProgram } } },
          instanceBufferLayout: { buffer: instance }, vertexBufferLayout: { buffer: vertex },
        } });
        return { vao, instance, vertex, destroy };
      });
      renderer.deleteBuffer.mockClear();
      system.destroy();
      system.destroy();
      expect(renderer.deleteBuffer).toHaveBeenCalledTimes(layers.length * 2);
      for (const resource of owned) {
        expect(renderer.deleteBuffer).toHaveBeenCalledWith(resource.instance);
        expect(renderer.deleteBuffer).toHaveBeenCalledWith(resource.vertex);
        expect(resource.vao.destroy).toHaveBeenCalledOnce();
        expect(resource.destroy).toHaveBeenCalledOnce();
      }
      expect(renderer.glVAOWrappers).toEqual([unrelatedVao]);
    }
    expect(sharedProgram.destroy).not.toHaveBeenCalled();
    expect(unrelatedVao.destroy).not.toHaveBeenCalled();
  });

  it('keeps wall and nature material separate through patch, removal and cell reuse', () => {
    const wall = { ...state(0, 3, 5), material: 'walls' as const };
    const nature = state(1, 4, 5);
    const { system, layers } = fixture([wall, nature]);
    const wallSlot = 5 * 16 + 3, rockSlot = wallSlot + 1;
    expect(layers[0].members[wallSlot]).toMatchObject({ alpha: 0 });
    expect(layers[0].members[rockSlot]).toMatchObject({ frame: { textureKey: 'rock_base' } });
    expect(layers[2].members[wallSlot]).toMatchObject({ frame: { textureKey: 'walls' }, alpha: 1 });
    expect(system.getDiagnostics().capacity).toBe(3 * 256);
    wall.active = false; system.applyDirty([0]);
    expect(layers[2].members[wallSlot]).toMatchObject({ alpha: 0 });
    Object.assign(wall, { active: true, material: 'rocks' }); system.applyDirty([0]);
    expect(layers[0].members[wallSlot]).toMatchObject({ frame: { textureKey: 'rock_base' }, alpha: 1 });
    expect(layers[2].members[wallSlot]).toMatchObject({ alpha: 0 });
    system.destroy();
  });

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
