export const overlaps = (a, b) => a.toMs > b.fromMs && a.fromMs < b.toMs;
export const contained = (a, b) => a.fromMs >= b.fromMs && a.toMs <= b.toMs;
export const overlapMs = (a, b) => Math.max(0, Math.min(a.toMs, b.toMs) - Math.max(a.fromMs, b.fromMs));
export const length = a => a.toMs - a.fromMs;

export const COST_SCOPES = {
  gameCallback: ['Spiel-Callback gesamt (inklusive)', null],
  sceneManager: ['Alle Scenes / SceneManager (inklusive)', 'gameCallback'],
  scenePreUpdate: ['Arena PRE_UPDATE: Systeme / Plugins', 'sceneManager'],
  sceneSystems: ['Arena UPDATE: Phaser-Systeme / automatische Physik', 'sceneManager'],
  sceneUpdate: ['Arena Scene.update (inklusive)', 'sceneManager'],
  gameplay: ['Host-/Client-Schritt, einschließlich eigener Physik (inklusive)', 'sceneUpdate'],
  visualTail: ['Visueller Update-Abschnitt, UI, Bakes und Netzwerk-Flush', 'sceneUpdate'],
  sceneUpdateOther: ['Rest von Arena Scene.update (ohne die beiden Teilbereiche)', 'sceneUpdate'],
  scenePostUpdate: ['Arena POST_UPDATE: visuelle Updates, Systeme und Offscreen-Arbeit', 'sceneManager'],
  rendererSetup: ['Renderer-Vorbereitung', 'gameCallback'],
  renderSubmit: ['Render-Submission, Szenen/Kameras und Abschluss (inklusive)', 'gameCallback'],
  unattributedCallback: ['Nicht weiter zugeordneter Rest des Spiel-Callbacks', 'gameCallback'],
};

function unionLength(spans, parent) {
  const ranges = spans.filter(s => overlaps(s, parent)).map(s => [Math.max(s.fromMs, parent.fromMs), Math.min(s.toMs, parent.toMs)]).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [from, to] of ranges) { total += Math.max(0, to - Math.max(from, end)); end = Math.max(end, to); }
  return total;
}

export function prepareIntervals(result) {
  const capture = result.game.frameCapture, origin = capture.startedAtPerformanceMs;
  const work = (capture.work ?? []).map(w => ({ ...w, fromMs: w.fromMs + origin, toMs: w.toMs + origin,
    spans: w.spans.map(s => ({ ...s, fromMs: s.fromMs + origin, toMs: s.toMs + origin })) }));
  const cpu = work.flatMap(w => {
    if (!w.complete) return []; // The partial callback remains separately visible.
    const parent = { scope: 'gameCallback', fromMs: w.fromMs, toMs: w.toMs, frameId: w.frameId };
    const spans = w.spans.map(s => ({ ...s, frameId: w.frameId }));
    const extra = [{ ...parent, scope: 'unattributedCallback', measuredMs: length(w) - unionLength(spans.filter(s => ['sceneManager', 'rendererSetup', 'renderSubmit'].includes(s.scope)), w) }];
    for (const scene of spans.filter(s => s.scope === 'sceneUpdate')) extra.push({ ...scene, scope: 'sceneUpdateOther',
      measuredMs: length(scene) - unionLength(spans.filter(s => ['gameplay', 'visualTail'].includes(s.scope)), scene) });
    return [parent, ...spans, ...extra];
  });
  const frames = capture.frames.map((f, index) => {
    const previous = capture.frames[index - 1];
    const toMs = f[1] + origin, fromMs = toMs - f[2];
    return { frameId: f[0], fromMs, toMs, atMs: toMs, durationMs: f[2],
      // These gauges were sampled during the work that precedes the interval's ending rAF.
      enemies: previous?.[0] === f[0] - 1 ? previous[5] : null,
      projectiles: previous?.[0] === f[0] - 1 ? previous[6] : null };
  }).filter(f => Number.isFinite(f.durationMs) && f.durationMs > 0);
  const gpu = result.game.series.gpuSamples.map(g => ({ ...g, fromMs: g.atMs + origin, toMs: g.submissionEndMs + origin }))
    .filter(g => Number.isFinite(g.toMs) && g.toMs >= g.fromMs && Number.isFinite(g.durationMs));
  return { work, cpu, frames, gpu };
}

/** Full measured durations only; boundary spans are never proportionally divided. */
export function costOverview(data, window, metric) {
  const cpu = data.cpu.filter(s => overlaps(s, window));
  return {
    scopes: Object.fromEntries(Object.keys(COST_SCOPES).map(scope => [scope,
      metric(cpu.filter(s => s.scope === scope && contained(s, window)).map(s => s.measuredMs ?? length(s)))])),
    boundarySpans: cpu.filter(s => !contained(s, window)).map(s => ({ ...s, durationMs: s.measuredMs ?? length(s), overlapMs: overlapMs(s, window) })),
    partialCallbacks: data.work.filter(w => !w.complete && overlaps(w, window)).map(w => ({ frameId: w.frameId, fromMs: w.fromMs, toMs: w.toMs })),
  };
}

export function spikeWork(data, interval) {
  const work = data.work.filter(w => overlaps(w, interval));
  const cpu = data.cpu.filter(s => overlaps(s, interval));
  return { callbacks: work.map(w => ({ frameId: w.frameId, fromMs: w.fromMs, toMs: w.toMs, complete: w.complete,
      crossesInterval: !contained(w, interval), drawCalls: w.drawCalls, offscreenDrawCalls: w.offscreenDrawCalls })),
    scopes: cpu.map(s => ({ ...s, durationMs: s.measuredMs ?? length(s), crossesInterval: !contained(s, interval) })),
    outsideCapturedCallbacksMs: length(interval) - unionLength(work, interval) };
}
