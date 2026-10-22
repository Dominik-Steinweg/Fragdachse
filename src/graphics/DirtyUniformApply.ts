import type * as Phaser from 'phaser';

type Program = Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
type Manager = Phaser.Renderer.WebGL.ProgramManager;
type Renderer = Phaser.Renderer.WebGL.WebGLRenderer;
export type DirtyUniformSetter = (name: string, value: unknown) => void;

// Phaser.Renderer.Events.RESTORE_WEBGL; a literal keeps this module free of Phaser's runtime.
const RESTORE_WEBGL = 'restorewebgl';
// Programs are shared by every batch handler with the same material; the last manager that
// applied to a program decides whether a partial apply is still valid for it.
let lastApplier = new WeakMap<Program, Manager>();
const restoreListeners = new WeakSet<Renderer>();

/**
 * Per-chunk materials re-run setupUniforms for every draw. Phaser then forwards every stored
 * uniform to the program and compares each value again, although only a few per-chunk values
 * change. Uniforms written through the returned setter are forwarded only when written since
 * this manager's previous apply to the same program; everything is forwarded when another
 * manager or program came in between. Phaser's own base uniforms are forwarded as before.
 * GL results are unchanged: Phaser still compares each forwarded value with the program's.
 */
export function installDirtyUniformApply(manager: Manager, renderer: Renderer): DirtyUniformSetter {
  if (!restoreListeners.has(renderer)) {
    restoreListeners.add(renderer);
    // A restored context recreates program state; the next apply must forward everything.
    renderer.on?.(RESTORE_WEBGL, () => { lastApplier = new WeakMap(); });
  }
  const owned = new Set<string>(), dirty = new Set<string>();
  let lastProgram: Program | null = null;
  manager.applyUniforms = function (this: Manager, program: Program): void {
    const uniforms = this.uniforms as Record<string, unknown>;
    const full = lastApplier.get(program) !== this || lastProgram !== program;
    if (full) { lastApplier.set(program, this); lastProgram = program; }
    for (const name in uniforms) {
      if (full || !owned.has(name) || dirty.has(name)) program.setUniform(name, uniforms[name] as never);
    }
    dirty.clear();
  };
  return (name, value) => {
    manager.setUniform(name, value);
    owned.add(name);
    dirty.add(name);
  };
}
