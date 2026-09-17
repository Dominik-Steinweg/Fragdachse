import { overlaps, contained, overlapMs, prepareIntervals, costOverview, spikeWork } from './intervals.mjs';
export { COST_SCOPES } from './intervals.mjs';
export const MEASUREMENT_VERSION = 2;

export function metric(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { count: sorted.length, average: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: percentile(.5), p95: percentile(.95), p99: percentile(.99), maximum: sorted.at(-1) };
}
const fps = frame => frame?.average > 0 ? 1000 / frame.average : null;

export function summarizeWindows(result) {
  const capture = result.game.frameCapture;
  if (!capture || capture.truncated || capture.autoStopped || result.game.series.truncated || result.game.session.eventsTruncated) throw new Error('Missing or incomplete game frame capture');
  if (capture.version !== MEASUREMENT_VERSION) throw new Error('Unsupported frame measurement semantics; make a new recording');
  const data = prepareIntervals(result);
  return result.windows.map(window => {
    const overlapping = data.frames.filter(f => overlaps(f, window));
    const inside = overlapping.filter(f => contained(f, window));
    const boundaryIntervals = overlapping.filter(f => !contained(f, window)).map(f => ({ ...f,
      overlapMs: overlapMs(f, window), phaseIds: result.windows.filter(w => overlaps(f, w)).map(w => w.id) }));
    const frame = metric(inside.map(f => f.durationMs));
    const overBudget = Object.fromEntries([1000 / 120, 1000 / 60, 1000 / 30, 50].map(threshold => {
      const count = inside.filter(f => f.durationMs > threshold).length;
      return [threshold, { count, percent: inside.length ? count / inside.length * 100 : null,
        boundaryCount: boundaryIntervals.filter(f => f.durationMs > threshold).length }];
    }));
    const costs = costOverview(data, window, metric);
    const spikes = [...overlapping].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10).map(f => ({ ...f,
      crossesPhase: !contained(f, window), overlapMs: overlapMs(f, window),
      phaseIds: result.windows.filter(w => overlaps(f, w)).map(w => w.id), work: spikeWork(data, f) }));
    const sections = [];
    for (let fromMs = window.fromMs; fromMs < window.toMs; fromMs += 2000) {
      const range = { fromMs, toMs: window.toMs - (fromMs + 2000) < 1000 ? window.toMs : fromMs + 2000 };
      const frames = overlapping.filter(f => contained(f, range));
      const sectionFrame = metric(frames.map(f => f.durationMs));
      sections.push({ ...range, frame: sectionFrame, fps: fps(sectionFrame),
        boundaryCount: overlapping.filter(f => overlaps(f, range) && !contained(f, range)).length,
        enemies: metric(frames.map(f => f.enemies)), projectiles: metric(frames.map(f => f.projectiles)) });
      if (range.toMs === window.toMs) break;
    }
    const reliable = sections.filter(s => s.frame?.count >= 20 && s.toMs - s.fromMs >= 1000);
    const first = reliable[0], last = reliable.at(-1);
    const trend = first && last !== first && last.frame.median > first.frame.median * 1.25 && last.frame.median - first.frame.median > 2
      ? { first, last, ratio: last.frame.median / first.frame.median } : null;
    const spikeThresholdMs = Math.max(1000 / 120, (frame?.median ?? 0) * 1.5);
    const recurringSpikes = sections.map(s => ({ fromMs: s.fromMs, toMs: s.toMs,
      count: inside.filter(f => contained(f, s) && f.durationMs > spikeThresholdMs).length, thresholdMs: spikeThresholdMs }))
      .filter(s => s.count >= 2).sort((a, b) => b.count - a.count).slice(0, 3);
    const gpuInside = data.gpu.filter(g => contained(g, window));
    const gpuBoundary = data.gpu.filter(g => overlaps(g, window) && !contained(g, window));
    const workInside = data.work.filter(w => w.complete && contained(w, window));
    const drawCalls = metric(workInside.map(w => w.drawCalls));
    const issues = [];
    if (!frame) issues.push('Keine vollständig enthaltenen Frame-Intervalle; Grenzintervalle separat lesen.');
    if (window.kind !== 'startup' && !costs.scopes.gameCallback) issues.push('Keine vollständig enthaltenen Spiel-Callbacks gemessen.');
    if (!drawCalls) issues.push('Draw Calls nicht verfügbar; fehlende/ungültige Hooks oder keine vollständig erfassten Callbacks.');
    if (result.game.summaries.renderPipeline?.status === 'invalid') issues.push('WebGL-Zählung ungültig (Kontextverlust oder veränderte Hooks).');
    return { ...window, measurementVersion: MEASUREMENT_VERSION, durationMs: window.toMs - window.fromMs,
      frame, fps: fps(frame), boundaryFrame: metric(boundaryIntervals.map(f => f.durationMs)), boundaryIntervals,
      overlappingFrame: metric(overlapping.map(f => f.durationMs)), coverageStartMs: overlapping[0]?.fromMs ?? null, costs,
      hostStep: costs.scopes.gameplay, renderSubmit: costs.scopes.renderSubmit,
      gpu: metric(gpuInside.map(g => g.durationMs)), gpuBoundary,
      gpuStatus: gpuInside.length ? 'sampled' : result.game.summaries.gpu.status === 'supported' ? 'no-contained-valid-samples' : result.game.summaries.gpu.status,
      drawCalls, offscreenDrawCalls: metric(workInside.map(w => w.offscreenDrawCalls)),
      renderCounterScope: result.game.summaries.renderPipeline?.scope ?? 'unavailable',
      load: { ...window.load, enemies: metric(inside.map(f => f.enemies)), projectiles: metric(inside.map(f => f.projectiles)) },
      overBudget, spikes, recurringSpikes, sections, trend, issues };
  });
}

/** Balanced categories: persistent load cannot crowd all one-off stalls out of the entry report. */
export function findings(windows) {
  const groups = { 'Messprobleme': [], 'Einzelhänger': [], 'Verschlechterung im Verlauf': [], 'Dauerlast': [], 'Laden / Übergang': [] };
  const seenHangs = new Set();
  for (const w of windows) {
    if (w.kind !== 'startup' && w.durationMs >= 1000) for (const issue of w.issues ?? []) groups.Messprobleme.push({ type: 'Messprobleme', caseId: w.id, value: 1, text: issue });
    if (w.kind === 'measurement') {
      const largest = w.spikes?.find(s => s.durationMs > 50 && !seenHangs.has(s.frameId));
      if (largest) {
        seenHangs.add(largest.frameId);
        groups.Einzelhänger.push({ type: 'Einzelhänger', caseId: w.id, value: largest.durationMs,
          text: `${largest.durationMs.toFixed(2)} ms, ${(largest.fromMs / 1000).toFixed(3)}–${(largest.toMs / 1000).toFixed(3)} s.${largest.crossesPhase ? ` Phasengrenze: ${largest.phaseIds.join(', ')}; nicht vollständig diesem Fall zurechnen.` : ''}` });
      }
      if (w.trend) groups['Verschlechterung im Verlauf'].push({ type: 'Verschlechterung im Verlauf', caseId: w.id, value: w.trend.ratio,
        text: `Median ${w.trend.first.frame.median.toFixed(2)} → ${w.trend.last.frame.median.toFixed(2)} ms; Zeitabschnitte und tatsächliche Last vergleichen.` });
      if (w.frame?.median > 1000 / 120) groups.Dauerlast.push({ type: 'Dauerlast', caseId: w.id, value: w.frame.median,
        text: `Median ${w.frame.median.toFixed(2)} ms, p95 ${w.frame.p95.toFixed(2)} ms. Frame-Takt allein beweist keinen CPU-/GPU-Engpass.` });
    } else if (w.durationMs > 1000 || w.overlappingFrame?.maximum > 50) {
      groups['Laden / Übergang'].push({ type: 'Laden / Übergang', caseId: w.id, value: w.overlappingFrame?.maximum ?? w.durationMs,
        text: `Phase ${(w.durationMs / 1000).toFixed(2)} s; längstes überlappendes Intervall ${w.overlappingFrame?.maximum?.toFixed(2) ?? 'nicht verfügbar'} ms (Grenzen separat).` });
    }
  }
  const lists = Object.values(groups).map(list => list.sort((a, b) => b.value - a.value));
  const balanced = [];
  for (let i = 0; lists.some(list => list[i]); i++) for (const list of lists) if (list[i]) balanced.push({ ...list[i], evidence: 'observation' });
  return balanced;
}

export function compareResults(a, b) {
  const warnings = [];
  for (const key of ['scenarioVersion', 'scenarioDataHash', 'caseId', 'durationMs', 'captureProfile', 'captureProfileVersion', 'traceCategories', 'browserVersion', 'launchOptions', 'hardware', 'environment']) {
    if (JSON.stringify(a.manifest[key]) !== JSON.stringify(b.manifest[key])) warnings.push(`Abweichung: ${key}`);
  }
  if (a.summary.schemaVersion !== b.summary.schemaVersion) warnings.push('Inkompatible Messsemantik / Summary-Version');
  const cases = a.summary.windows.filter(w => w.kind === 'measurement').map(left => {
    const right = b.summary.windows.find(w => w.id === left.id && w.kind === left.kind);
    if (!right) return { id: left.id, status: 'missing' };
    if (a.summary.schemaVersion !== b.summary.schemaVersion || left.measurementVersion !== right.measurementVersion) return { id: left.id, status: 'incompatible-measurement' };
    if (a.manifest.scenarioVersion !== b.manifest.scenarioVersion || left.caseVersion !== right.caseVersion) return { id: left.id, status: 'incompatible-scenario', loadA: left.load, loadB: right.load };
    const differences = {};
    for (const group of ['frame', 'hostStep', 'renderSubmit', 'gpu', 'drawCalls', 'offscreenDrawCalls']) {
      differences[group] = Object.fromEntries(['median', 'p95', 'p99', 'maximum'].map(key => {
        const before = left[group]?.[key], after = right[group]?.[key];
        return [key, Number.isFinite(before) && Number.isFinite(after) ? { before, after, absolute: after - before, percent: before ? (after - before) / before * 100 : null } : null];
      }));
    }
    return { id: left.id, status: warnings.length ? 'conditions-differ' : 'review-load-and-variance',
      loadChanged: JSON.stringify(left.load) !== JSON.stringify(right.load), loadA: left.load, loadB: right.load,
      boundaryIntervalsA: left.boundaryIntervals, boundaryIntervalsB: right.boundaryIntervals,
      durationA: left.durationMs, durationB: right.durationMs, differences };
  });
  for (const right of b.summary.windows.filter(w => w.kind === 'measurement')) if (!cases.some(c => c.id === right.id)) cases.push({ id: right.id, status: 'added' });
  return { schemaVersion: 2, warnings, cases, interpretation: 'Beobachteter Unterschied, kein Signifikanztest oder automatischer Optimierungserfolg.' };
}
