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
