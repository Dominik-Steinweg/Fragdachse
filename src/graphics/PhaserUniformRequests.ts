import type * as Phaser from 'phaser';

type Program = Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
type RequestCallback = (name: string, value: unknown) => unknown;
interface ProgramInternals {
  uniformRequests: { each(callback: RequestCallback): unknown } | UniformRequestMap;
  renderer: { glWrapper: { updateBindingsProgram(state: unknown): void } };
  glState: unknown;
  _processUniformRequest(name: string, value: unknown): void;
}

/**
 * The subset of `Phaser.Structs.Map` that WebGLProgramWrapper uses, backed by a native Map.
 * Phaser 4.2.1 keeps requests in an object map: every bind iterates it with `for...in`, then
 * deletes each key, which turns the object into a slow dictionary. That ran for every program
 * bind of every batch switch. Iteration keeps insertion order, as `for...in` did for these keys.
 */
export class UniformRequestMap {
  private readonly map = new Map<string, unknown>();
  get size(): number { return this.map.size; }
  set(name: string, value: unknown): this { this.map.set(name, value); return this; }
  get(name: string): unknown { return this.map.get(name); }
  has(name: string): boolean { return this.map.has(name); }
  delete(name: string): this { this.map.delete(name); return this; }
  clear(): this { this.map.clear(); return this; }
  keys(): string[] { return [...this.map.keys()]; }
  values(): unknown[] { return [...this.map.values()]; }
  getArray(): unknown[] { return this.values(); }
  each(callback: RequestCallback): this {
    // forEach avoids an entry array per request on every program bind; `false` still stops.
    let stopped = false;
    this.map.forEach((value, name) => { if (!stopped && callback(name, value) === false) stopped = true; });
    return this;
  }
}

const installed = new WeakSet<object>();
const processors = new WeakMap<object, RequestCallback>();

function requestsOf(program: ProgramInternals): UniformRequestMap {
  const current = program.uniformRequests;
  if (current instanceof UniformRequestMap) return current;
  const next = new UniformRequestMap();
  current?.each((name, value) => { next.set(name, value); });
  program.uniformRequests = next;
  return next;
}

/** Install before constructing Phaser.Game. Same requests, same order, same GL calls. */
export function installPhaserUniformRequests(prototype: Program): void {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const target = prototype as unknown as ProgramInternals & {
    setUniform(name: string, value: unknown): void; bind(): void;
  };
  target.setUniform = function (this: ProgramInternals, name: string, value: unknown): void {
    requestsOf(this).set(name, value);
  };
  target.bind = function (this: ProgramInternals): void {
    this.renderer.glWrapper.updateBindingsProgram(this.glState);
    const requests = requestsOf(this);
    if (!requests.size) return;
    let process = processors.get(this);
    if (!process) processors.set(this, process = this._processUniformRequest.bind(this));
    requests.each(process);
    requests.clear();
  };
}
