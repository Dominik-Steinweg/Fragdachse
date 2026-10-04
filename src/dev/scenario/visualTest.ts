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
