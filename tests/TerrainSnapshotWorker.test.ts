import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Textures: { FilterMode: { LINEAR: 0 } }, GameObjects: { Image: class {
  constructor(..._args: unknown[]) {} setOrigin() { return this; } setPosition() { return this; } destroy() {}
} } }));
import { TerrainSnapshotMaterial, type TerrainSnapshotMaterialSource } from '../src/arena/TerrainSnapshotMaterial';
import { TerrainSnapshotWorkerClient } from '../src/arena/TerrainSnapshotWorkerClient';
import { TerrainSnapshotStaging } from '../src/arena/TerrainSnapshotStaging';
import { DirtSurfaceLayer } from '../src/arena/DirtSurfaceLayer';
import { DirtSurfaceField } from '../src/arena/DirtSurfaceField';
import { writeTrackBallast } from '../src/arena/TrackGravelField';
import { TERRAIN_SNAPSHOT_SCALE } from '../src/arena/TerrainColorSnapshotBuilder';
import { terrainSnapshotTexel } from '../src/arena/TerrainSnapshotSampling';
import type { TerrainSnapshotRequest, TerrainSnapshotResult } from '../src/arena/TerrainSnapshotWorker';

const frame = { offsetX: 37, offsetY: 19, width: 512, height: 512 };
const rgba = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, i) => (i * 37) & 255);
const texture = { width: 64, height: 64, rgba };
const materials = { dirt: texture, dirtAlt: texture, bank: texture, bankWet: texture, gravel: texture,
  grassHeight: { width: 64, height: 64, data: Uint8Array.from({ length: 4096 }, (_, i) => i & 255) } };
const source: TerrainSnapshotMaterialSource = { kind: 'soil', seed: 17, frame, materials,
  dirt: [{ gridX: 2, gridY: 1 }, { gridX: 3, gridY: 1 }], water: [{ gridX: 2, gridY: 2 }] };

class Port {
  onmessage: ((e: { data: TerrainSnapshotResult }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly jobs: TerrainSnapshotRequest[] = [];
  readonly fields = new Map<number, TerrainSnapshotMaterial>();
  terminate = vi.fn();
  postMessage(value: TerrainSnapshotRequest, transfer: ArrayBuffer[] = []) {
    this.jobs.push(structuredClone(value, { transfer }));
  }
  reply() {
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      if (job.kind === 'init') { this.fields.set(job.id, new TerrainSnapshotMaterial(job.source)); continue; }
      if(job.native)this.fields.get(job.id)!.writeNative(new Uint8ClampedArray(job.buffer),job.side,job.x,job.y);
      else this.fields.get(job.id)!.write(new Uint8ClampedArray(job.buffer), job.side, job.x, job.y, job.width, job.height);
      this.onmessage?.({ data: structuredClone({ buffer: job.buffer, cpuMs: 1 }, { transfer: [job.buffer] }) });
      return;
    }
  }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('terrain snapshot sampling and worker lifetime', () => {
  it.each(['soil', 'track'] as const)('preserves every linear-filter support texel for %s, including batch/tile boundaries', kind => {
    const input: TerrainSnapshotMaterialSource = kind === 'soil' ? source : { kind, seed: 17, frame, materials,
      columns: [{ x: 101, y: 19, width: 32, height: 512 }] };
    const field = new TerrainSnapshotMaterial(input), side = 256;
    const sparse = new Uint8ClampedArray(side * side * 4), full = new Uint8ClampedArray(sparse.length);
    const soil = new DirtSurfaceField(17, source.kind === 'soil' ? source.dirt : [], frame,
      source.kind === 'soil' ? source.water : []);
    for (const dx of [0, 256, 0]) {
      const x = frame.offsetX + dx, y = frame.offsetY;
      field.write(sparse, side, x, y, side, side);
      if (input.kind === 'soil') soil.writeSurface(full, side, x, y, side, materials);
      else writeTrackBallast(full, side, input.seed, input.columns, frame, { worldX: x, worldY: y, size: side },
        { gravel: texture, soil: texture });
      let compared = 0;
      for (let py = 0; py < side; py++) for (let px = 0; px < side; px++) {
        const index = (py * side + px) * 4;
        if (terrainSnapshotTexel(px) && terrainSnapshotTexel(py)) {
          for (let c = 0; c < 4; c++) if (sparse[index + c] !== full[index + c]) throw new Error(`RGBA differs at ${x + px},${y + py},${c}`);
          compared++;
        } else if (sparse.subarray(index, index + 4).some(v => v !== 0)) throw new Error('Unused texel retained stale data');
      }
      expect(compared).toBe(side * side / 4);
      // Pixel-centre mapping: the unchanged camera scale reads precisely these 2x2 supports.
      for (let pixel = 0; pixel < side / TERRAIN_SNAPSHOT_SCALE; pixel++) {
        const coordinate = (pixel + .5) * TERRAIN_SNAPSHOT_SCALE - .5;
        expect(terrainSnapshotTexel(Math.floor(coordinate))).toBe(true);
        expect(terrainSnapshotTexel(Math.ceil(coordinate))).toBe(true);
      }
    }
  });

  it('transfers one bounded batch, retains source buffers and ignores late results after teardown', () => {
    const port = new Port(), client = new TerrainSnapshotWorkerClient(() => port as unknown as Worker);
    const buffer = new ArrayBuffer(128 * 128 * 4), sourceBytes = rgba.byteLength;
    client.request(source, 128, 37, 19, 128, 128, buffer);
    expect(buffer.byteLength).toBe(0); expect(rgba.byteLength).toBe(sourceBytes);
    expect(client.take()).toBeNull();
    expect(() => client.request(source, 128, 37, 19, 128, 128, new ArrayBuffer(65536))).toThrow('lifetime');
    port.reply(); const returned = client.take()!;
    expect(returned.byteLength).toBe(65536); expect(client.take()).toBeNull();
    client.request(source, 128, 165, 19, 128, 128, returned);
    expect(port.jobs).toHaveLength(1); // immutable material initialized only once
    const late = port.onmessage!;
    client.destroy(); client.destroy(); late({ data: { buffer: new ArrayBuffer(4), cpuMs: 1 } });
    expect(client.take()).toBeNull(); expect(port.terminate).toHaveBeenCalledOnce();
    expect(port.onmessage).toBeNull(); expect(port.onerror).toBeNull(); expect(port.onmessageerror).toBeNull();
  });

  it.each(['error', 'messageerror'])('propagates %s instead of publishing an empty snapshot', type => {
    const port = new Port(), client = new TerrainSnapshotWorkerClient(() => port as unknown as Worker);
    if (type === 'error') port.onerror!({ message: 'worker failed' }); else port.onmessageerror!();
    expect(() => client.take()).toThrow(); client.destroy();
  });

  it('stages only completed worker batches, never invokes native main-thread computation, and releases everything', () => {
    const port = new Port();
    vi.stubGlobal('Worker', class { constructor() { return port; } });
    vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
    const put = vi.fn(), remove = vi.fn(), refresh = vi.fn(), draw = vi.fn(), render = vi.fn();
    const scene = { textures: { createCanvas: () => ({ key: 'stage', setFilter() {}, context: { putImageData: put }, refresh }), remove } };
    const staging = new TerrainSnapshotStaging(scene as never, 128), native = vi.fn(() => { throw new Error('CPU fallback'); });
    const work = staging.draw({ draw, render } as never, { worldX: 37, worldY: 19, width: 128, height: 128 }, frame, native, source);
    expect(work.next().value).toBe(false); expect(work.next().value).toBe(false);
    expect(put).not.toHaveBeenCalled(); port.reply();
    expect(work.next().done).toBe(false); expect(put).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce(); expect(draw).toHaveBeenCalledOnce(); expect(render).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled(); expect(work.next().done).toBe(true);
    staging.destroy(); staging.destroy(); expect(port.terminate).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  });
});

it('transfers pixel-identical native soil tiles including gutters and releases native jobs on teardown',()=>{
 const port=new Port(),worker=new TerrainSnapshotWorkerClient(()=>port as never);
 const field=new DirtSurfaceField(source.seed,source.kind==='soil'?source.dirt:[],source.frame,source.kind==='soil'?source.water:[]);
 const side=132,reference=new Uint8ClampedArray(side*side*4);
 for(const [x,y] of [[35,17],[167,17],[299,149]]){
  field.writeSurface(reference,side,x,y,side,source.materials);
  worker.request(source,side,x,y,side,side,new ArrayBuffer(reference.length),true);
  expect(worker.take()).toBeNull();port.reply();expect(new Uint8ClampedArray(worker.take()!)).toEqual(reference);
 }
 worker.request(source,side,0,0,side,side,new ArrayBuffer(reference.length),true);worker.destroy();port.reply();
 expect(worker.take()).toBeNull();expect(port.terminate).toHaveBeenCalledOnce();
});

it('keeps a native chunk pending until its transferred material exists, then uploads without main-thread recalculation',()=>{
 const port=new Port();vi.stubGlobal('Worker',class {constructor(){return port;}});
 const put=vi.fn(),refresh=vi.fn(),remove=vi.fn();const side=132;
 const scene={textures:{createCanvas:()=>({key:'soil',context:{createImageData:()=>({width:side,height:side,data:new Uint8ClampedArray(side*side*4)}),putImageData:put},refresh}),remove}};
 const layer=new DirtSurfaceLayer(scene as never,source.seed,source.kind==='soil'?source.dirt:[],frame,side,materials,source.kind==='soil'?source.water:[]);
 expect(layer.prepare(35,17,side)).toBe(false);expect(layer.prepare(35,17,side)).toBe(false);expect(put).not.toHaveBeenCalled();
 port.reply();expect(layer.prepare(35,17,side)).toBe(true);
 const native=vi.spyOn(DirtSurfaceField.prototype,'writeSurface');
 const target={clear:vi.fn(),draw:vi.fn(),render:vi.fn()};layer.bake(target as never,{worldX:35,worldY:17,size:side} as never);
 expect(native).not.toHaveBeenCalled();expect(put).toHaveBeenCalledOnce();expect(refresh).toHaveBeenCalledOnce();expect(target.render).toHaveBeenCalledOnce();
 expect(layer.prepare(35,17,side)).toBe(true);layer.prepare(167,17,side);layer.destroy();port.reply();expect(port.terminate).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledWith('soil');
});
