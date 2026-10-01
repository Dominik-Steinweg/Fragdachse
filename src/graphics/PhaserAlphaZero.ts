import type * as Phaser from 'phaser';

type Manager = Phaser.Renderer.WebGL.ProgramManager;
type Addition = Phaser.Types.Renderer.WebGL.ShaderAdditionConfig;
const MARKER = 'FD_ALPHA_ZERO_V1';
const SUFFIX = '_FD_ALPHA_ZERO_V1';
const installed = new WeakSet<object>();
const sources = new Map<string, string>();

/** Phaser 4.2.1: retain every positive-alpha instruction verbatim. No epsilon. */
export function guardPhaserUnpremultiply(source: string): string {
  const cached = sources.get(source);
  if (cached !== undefined) return cached;
  if (source.includes(MARKER)) return source;
  let guarded = source;
  for (const [signature, value, exit] of [
    ['vec4 applyTint(vec4 texture)', 'texture', 'return vec4(0.0);'],
    ['vec4 getLighting (vec4 fragColor, vec3 normal)', 'fragColor', 'return vec4(0.0);'],
    // A zero-alpha fragment must not write stencil coverage either.
    ['vec4 applyAlphaDiscard(vec4 fragColor)', 'fragColor', 'discard;'],
  ]) {
    const start = guarded.indexOf(signature);
    if (start < 0) continue;
    const brace = guarded.indexOf('{', start) + 1;
    guarded = guarded.slice(0, brace) + `\n    // ${MARKER}\n    if (${value}.a <= 0.0) { ${exit} }` + guarded.slice(brace);
  }
  if (guarded.includes('vec3 unpremultipliedColor = color.rgb / color.a;')) {
    guarded = guarded.replace('vec3 unpremultipliedColor = color.rgb / color.a;',
      `// ${MARKER}\n    if (color.a <= 0.0) { gl_FragColor = vec4(0.0); return; }\n    vec3 unpremultipliedColor = color.rgb / color.a;`);
  }
  if (guarded.includes('sample.rgb /= sample.a;')) {
    guarded = guarded.replace('sample.rgb /= sample.a;',
      `// ${MARKER}\n        if (sample.a <= 0.0) { gl_FragColor = vec4(0.0); return; }\n        sample.rgb /= sample.a;`);
  }
  sources.set(source, guarded);
  return guarded;
}

function namespace(manager: Manager): void {
  const base = (manager.currentConfig as { base: { name: string } }).base;
  if (!base.name.endsWith(SUFFIX)) base.name += SUFFIX;
}
function guardAddition(manager: Manager, addition: Addition): void {
  const fields = addition.additions as Record<string, string>;
  const header = fields.fragmentHeader;
  if (!header) return;
  const guarded = guardPhaserUnpremultiply(header);
  if (!guarded.includes(MARKER)) return;
  fields.fragmentHeader = guarded;
  // DefineLights is looked up by its canonical name when maxLights changes.
  // Namespace its base program instead; Tint/AlphaDiscard retain their tags.
  if (addition.name !== 'DefineLights' && !addition.name.endsWith(SUFFIX)) addition.name += SUFFIX;
  namespace(manager);
}

/** Install before constructing Phaser.Game, including warmup/offscreen draws.
 * Configuration assembly covers batch handlers, private SpriteGPU submitters and
 * runtime alpha-strategy replacement. No draw hook or GPU resource is added.
 * Process-wide compatibility follows the pinned Phaser module's lifetime. */
export function installPhaserAlphaZero(prototype: Manager): void {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const { addAddition, replaceAddition, setBaseShader } = prototype;
  prototype.addAddition = function (addition, index) {
    guardAddition(this, addition);
    addAddition.call(this, addition, index);
  };
  prototype.replaceAddition = function (name, addition) {
    guardAddition(this, addition);
    replaceAddition.call(this, name, addition);
  };
  prototype.setBaseShader = function (name, vertex, fragment) {
    const guarded = guardPhaserUnpremultiply(fragment);
    setBaseShader.call(this, name, vertex, guarded);
    if (guarded.includes(MARKER)) namespace(this);
  };
}
