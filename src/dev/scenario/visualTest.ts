/** Opt-in only from dev-scenario.html. Wall timers and worker budgets stay real. */
export const visualTest = {
  enabled: false,
  seed: 12345,
  reseed: (_frame: number) => {},
};

export function installVisualTest(): void {
  if (new URLSearchParams(location.search).get('visual-test') !== '1') return;
  visualTest.enabled = true;
  let state = visualTest.seed;
  visualTest.reseed = frame => { state = (visualTest.seed + Math.imul(frame, 0x9e3779b9)) >>> 0; };
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  Date.now = () => 1700000000000;
}

/** RenderTexture uses Math.random-based UUIDs internally. Zero-delta worker publication
 * replays a frame's random stream, but resource identities must never be replayed.
 * Only repair a colliding auto UUID; authored texture-key errors remain visible. */
export function bindVisualTestTextureKeys(textures: import('phaser').Textures.TextureManager): () => void {
  if (!visualTest.enabled) return () => {};
  const original = textures.addDynamicTexture, originalCanvas = textures.createCanvas;
  let serial = 0;
  const unique = (key: string) => {
    if (typeof key === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(key) && textures.exists(key)) {
      do { key = `__visual_test_dynamic_${++serial}`; } while (textures.exists(key));
    }
    return key;
  };
  const wrapped: typeof original = function (key, width, height, forceEven) {
    return original.call(textures, typeof key === 'string' ? unique(key) : key, width, height, forceEven);
  };
  // Quality switches also rebuild UUID-named canvas masks at a frozen frame.
  const canvas: typeof originalCanvas = (key, width, height) => originalCanvas.call(textures, unique(key), width, height);
  textures.addDynamicTexture = wrapped;
  textures.createCanvas = canvas;
  return () => {
    if (textures.addDynamicTexture === wrapped) textures.addDynamicTexture = original;
    if (textures.createCanvas === canvas) textures.createCanvas = originalCanvas;
  };
}

/** The DOM boot fade normally resolves on CSS transitionend / a wall-time fallback.
 * Its completion admits the lobby and therefore chooses the round's clock and seeds.
 * In visual tests use a fixed presentation warmup instead. 800 ms retains the
 * reviewed reference phase of the lobby/HUD; it is not a wall-time sleep. */
export function bindVisualTestBootClock(
  boot: typeof import('../../ui/BootScreen').BootScreen,
  clock: Pick<import('phaser').Time.Clock, 'delayedCall'>,
): () => void {
  if (!visualTest.enabled) return () => {};
  const original = boot.fadeOut;
  let finish: (() => void) | null = null;
  const fade = (durationMs = 800) => new Promise<void>(resolve => {
    finish?.();
    const complete = () => {
      if (finish !== complete) return;
      finish = null; timer.remove(false); boot.dismissImmediate(); resolve();
    };
    const timer = clock.delayedCall(durationMs, complete);
    finish = complete;
  });
  boot.fadeOut = fade;
  return () => {
    finish?.();
    if (boot.fadeOut === fade) boot.fadeOut = original;
  };
}
