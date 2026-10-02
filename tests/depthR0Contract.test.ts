import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 } }));
import { GpuVfxLaneId, GPU_VFX_LANES } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxEffectId, GPU_VFX_EFFECTS } from '../src/effects/gpu/GpuVfxEffects';
import { auditLayerContract, layerProfiles, type LayerContract } from '../src/effects/EffectLayerContract';
import { CPU_LAYER_CONTRACTS, CPU_SOURCE_CONTRACTS, EFFECT_LAYER_CONTRACTS,
  GPU_EFFECT_CONTRACTS, GPU_LAYER_CONTRACTS } from '../src/effects/EffectLayerContract.data';
import { DEPTH_LAYER_EXCEPTIONS } from '../src/effects/EffectLayerContract.exceptions';
const { inventory, evaluate } = createRequire(import.meta.url)('./depthSource.cjs');
const blendNames = ['NORMAL','ADD','MULTIPLY','SCREEN'];
const unique = <T>(values: T[]) => [...new Set(values)].sort();

describe('R0 observed depth contract (diagnostics, never rendering inputs)', () => {
  it('classifies every GPU definition and physical lane, including additive variants', () => {
    expect(Object.keys(GPU_LAYER_CONTRACTS).sort()).toEqual(Object.keys(GpuVfxLaneId).sort());
    expect(Object.keys(GPU_EFFECT_CONTRACTS).sort()).toEqual(Object.keys(GpuVfxEffectId).sort());
    for (const [name,id] of Object.entries(GpuVfxLaneId)) {
      const actual = GPU_VFX_LANES[id], observed = GPU_LAYER_CONTRACTS[name as keyof typeof GPU_LAYER_CONTRACTS];
      expect(actual.depth, name).toBe(observed.depths[0]);
      expect(blendNames[actual.blendMode], name).toBe(observed.blends[0]);
    }
    for (const [name,id] of Object.entries(GpuVfxEffectId)) {
      const effect = GPU_VFX_EFFECTS[id], observed = GPU_EFFECT_CONTRACTS[name as keyof typeof GPU_EFFECT_CONTRACTS];
      const ids = effect.laneAdditive === undefined ? [effect.lane] : [effect.lane, effect.laneAdditive];
      expect(ids, name).toEqual(observed.lanes.map(lane => GpuVfxLaneId[lane]));
      expect(unique(ids.map(id => GPU_VFX_LANES[id].depth)), name).toEqual(unique([...observed.depths]));
      expect(unique(ids.map(id => blendNames[GPU_VFX_LANES[id].blendMode])), name).toEqual(unique([...observed.blends]));
    }
  });
  it('resolves CPU depth expressions against live constants and checks blend/camera selectors', () => {
    for (const [owner, expected] of Object.entries(CPU_SOURCE_CONTRACTS)) {
      const file = resolve('src', owner), actual = inventory(file);
      expect(actual.rows.map(({key,expression,blends}: any) => ({key,expression,blends})), owner).toEqual(expected.sites);
      expect(actual.blends, owner).toEqual(expected.blends);
      expect(actual.cameras, owner).toEqual(expected.cameras);
      const contracts = CPU_LAYER_CONTRACTS.filter(c => c.owner === owner);
      expect(contracts.length, owner).toBe(actual.rows.length);
      for (const row of actual.rows) {
        const contract = contracts.find(c => c.source?.selector === row.key)!;
        expect(contract, `${owner}:${row.key}`).toBeDefined();
        if(contract.role!=='delegate') expect(unique(evaluate(row.node, file, expected.bindings)), contract.id).toEqual(unique([...contract.depths]));
        expect(row.blends, contract.id).toEqual([...contract.blends]);
      }
    }
  });
  it('requires new CPU render owners to enter the catalog; adapters remain source-linked', () => {
    const owners: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(resolve('src',dir),{withFileTypes:true})) {
        const file=dir+'/'+entry.name;
        if(entry.isDirectory())walk(file);
        else if(file.endsWith('.ts') && !/EffectLayerContract|effects\/(?:gpu\/|groundFog\/|sunlight\/|postfx\/|Character|characterMesh|Shadow|train\/)|scenes\/arena\/(?:Clarity|clarity)/.test(file)
          && inventory(resolve('src',file)).rows.length)owners.push(file);
      }
    }
    for(const dir of ['effects','entities','projectile','powerups','ui','adrenalineEssence','scenes/arena'])walk(dir);
    owners.push('arena/BaseAccentGlowRenderer.ts');
    expect(owners.sort()).toEqual(Object.keys(CPU_SOURCE_CONTRACTS).sort());
  });
  it('stores the effective profiles and explicitly represents insertion-order boundaries', () => {
    expect(layerProfiles(14.5)).toEqual(['K','L']); expect(layerProfiles(20)).toEqual(['E','H']);
    expect(layerProfiles(42,'clarity')).toEqual(['C']);
    for(const layer of EFFECT_LAYER_CONTRACTS) {
      if(layer.role!=='delegate')expect(layer.depths.length,layer.id).toBeGreaterThan(0);
      expect(unique(layer.depths.flatMap(d=>layerProfiles(d,layer.clarityDepths?.includes(d)?'clarity':layer.camera))),layer.id).toEqual(unique([...layer.profiles]));
    }
  });
  it('reports exactly the known findings, rejecting new AND stale exceptions', () => {
    expect(auditLayerContract(EFFECT_LAYER_CONTRACTS,DEPTH_LAYER_EXCEPTIONS)).toEqual([]);
    expect(DEPTH_LAYER_EXCEPTIONS.filter(e=>e.finding==='D07')).toHaveLength(1);
    expect(DEPTH_LAYER_EXCEPTIONS.filter(e=>e.finding==='D08')).toHaveLength(3);
    const bad: LayerContract = {id:'unreviewed',owner:'test',component:'blood',height:'body',lighting:'material',
      depths:[25],blends:['NORMAL'],camera:'world',profiles:['H'],role:'effect'};
    expect(auditLayerContract([bad],[])).toContain('Unlisted: unreviewed:body-over-canopy');
    expect(auditLayerContract([], [{id:'gone',deviation:'sun-tie',finding:'D07'}])).toEqual(['Obsolete: gone:sun-tie']);
  });
  it('keeps observational metadata out of the production render dependency graph', () => {
    function check(dir: string) {
      for(const entry of readdirSync(dir,{withFileTypes:true})) {
        const p=dir+'/'+entry.name;
        if(entry.isDirectory())check(p);
        else if(p.endsWith('.ts')&&!entry.name.startsWith('EffectLayerContract'))
          expect(readFileSync(p,'utf8'),p).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*EffectLayerContract/);
      }
    }
    check(resolve('src'));
  });
  it('keeps P1 material under sunlight/canopy, emission outside ambient and stink residue below actors', () => {
    for (const name of ['GoreNormal', 'ExplosionLowBody', 'ExplosionLowSmoke'] as const) {
      const layer = GPU_LAYER_CONTRACTS[name];
      expect(layer.height).toBe('body'); expect(layer.lighting).toBe('material');
      expect(layer.profiles).toEqual(['K']);
      expect(DEPTH_LAYER_EXCEPTIONS.some(e => e.id === layer.id)).toBe(false);
    }
    for (const name of ['GoreAdd', 'ExplosionLowGlow'] as const) {
      const layer = GPU_LAYER_CONTRACTS[name];
      expect(layer.lighting).toBe('emissive'); expect(layer.profiles).toEqual(['E']);
      expect(DEPTH_LAYER_EXCEPTIONS.some(e => e.id === layer.id)).toBe(false);
    }
    const impact = GPU_LAYER_CONTRACTS.ExplosionLowCore;
    expect(impact.height).toBe('high'); expect(impact.lighting).toBe('emissive');
    expect(impact.profiles).toEqual(['H']);
    expect(DEPTH_LAYER_EXCEPTIONS.some(e => e.id === impact.id)).toBe(false);
    const flash = CPU_LAYER_CONTRACTS.find(c => c.owner === 'effects/EffectSystem.ts' && c.component === 'playExplosionEffect/flash/setDepth/0')!;
    expect(flash.height).toBe('high'); expect(flash.lighting).toBe('emissive');
    expect(flash.profiles).toEqual(['H']);
    expect(DEPTH_LAYER_EXCEPTIONS.some(e => e.id === flash.id)).toBe(false);
    const ground = CPU_LAYER_CONTRACTS.find(c => c.owner === 'effects/StinkCloudSystem.ts' && c.component.includes('groundGlow'))!;
    expect(ground.height).toBe('ground'); expect(ground.depths.every(depth => depth < 9.92)).toBe(true);
    expect(DEPTH_LAYER_EXCEPTIONS.some(e => e.id === ground.id)).toBe(false);
    // Explicitly deferred: stain ordering and composite/canopy ties remain debt.
    for (const finding of ['D04', 'D07', 'D08']) expect(DEPTH_LAYER_EXCEPTIONS.some(e => e.finding === finding)).toBe(true);
  });

});
