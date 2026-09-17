export function metric(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { count: sorted.length, average: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: percentile(.5), p95: percentile(.95), p99: percentile(.99), maximum: sorted.at(-1) };
}

export function summarizeWindows(result) {
  const capture = result.game.frameCapture;
  if (!capture || capture.truncated || capture.autoStopped || result.game.series.truncated || result.game.session.eventsTruncated) {
    throw new Error('Missing or incomplete game frame capture');
  }
  return result.windows.map(window => {
    const frames = capture.frames.filter(frame => {
      const at = frame[1] + capture.startedAtPerformanceMs;
      return at >= window.fromMs && at < window.toMs;
    });
    const frameIds = new Set(frames.map(frame => frame[0]));
    const gpu = result.game.series.gpuSamples.filter(sample => frameIds.has(sample.renderFrame));
    const intervals = frames.map(frame => frame[2]);
    const frame = metric(intervals);
    const overBudget = Object.fromEntries([1000 / 120, 1000 / 60, 1000 / 30, 50].map(threshold => {
      const count = intervals.filter(ms => ms > threshold).length;
      return [threshold, { count, percent: intervals.length ? count / intervals.length * 100 : null }];
    }));
    const spikes = [...frames].sort((a, b) => b[2] - a[2]).slice(0, 10).map(f => ({
      atMs: f[1] + capture.startedAtPerformanceMs, durationMs: f[2], frameId: f[0], enemies: f[5], projectiles: f[6],
    }));
    const spikeThresholdMs = Math.max(1000 / 120, (frame?.median ?? 0) * 1.5);
    const bins = new Map();
    for (const f of frames) {
      if (f[2] <= spikeThresholdMs) continue;
      const bin = Math.floor((f[1] + capture.startedAtPerformanceMs - window.fromMs) / 1000);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    const recurringSpikes = [...bins].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([bin, count]) => ({ fromMs: window.fromMs + bin * 1000, toMs: Math.min(window.toMs, window.fromMs + (bin + 1) * 1000), count, thresholdMs: spikeThresholdMs }));
    return { ...window, durationMs: window.toMs - window.fromMs,
      frame, fps: frame?.average > 0 ? 1000 / frame.average : null,
      coverageStartMs: frames.length ? frames[0][1] + capture.startedAtPerformanceMs : null,
      hostStep: metric(frames.map(f => f[3])), renderSubmit: metric(frames.map(f => f[4])),
      gpu: metric(gpu.map(g => g.durationMs)), gpuStatus: gpu.length ? 'sampled' : result.game.summaries.gpu.status === 'supported' ? 'no-valid-samples' : result.game.summaries.gpu.status,
      load: { ...window.load, enemies: metric(frames.map(f => f[5])), projectiles: metric(frames.map(f => f[6])) },
      overBudget, spikes, recurringSpikes };
  });
}

export function findings(windows) {
  return windows.filter(w => w.kind === 'measurement' && w.frame).flatMap(w => {
    const result = [];
    if (w.frame.median > 1000 / 120) result.push({ type: 'Grundlast', caseId: w.id, value: w.frame.median,
      text: `Median ${w.frame.median.toFixed(2)} ms; Bildschirmtakt/VSync und Arbeitszeiten getrennt prüfen.` });
    if (w.frame.p95 > 1000 / 60) result.push({ type: 'Wiederkehrende Spitzen', caseId: w.id, value: w.frame.p95,
      text: `p95 ${w.frame.p95.toFixed(2)} ms bei ${w.frame.count} Frames.` });
    if (w.frame.maximum > 50) result.push({ type: 'Einzelner Hänger', caseId: w.id, value: w.frame.maximum,
      text: `Maximum ${w.frame.maximum.toFixed(2)} ms bei ${(w.spikes[0].atMs / 1000).toFixed(3)} s Seitenzeit.` });
    return result;
  }).sort((a, b) => {
    const priority = { Grundlast: 0, 'Wiederkehrende Spitzen': 1, 'Einzelner Hänger': 2 };
    return priority[a.type] - priority[b.type] || b.value - a.value;
  });
}

export function compareResults(a, b) {
  const warnings = [];
  for (const key of ['scenarioVersion', 'scenarioDataHash', 'caseId', 'durationMs', 'captureProfile', 'captureProfileVersion', 'traceCategories', 'browserVersion', 'launchOptions', 'hardware', 'environment']) {
    if (JSON.stringify(a.manifest[key]) !== JSON.stringify(b.manifest[key])) warnings.push(`Abweichung: ${key}`);
  }
  const cases = a.summary.windows.filter(w => w.kind === 'measurement').map(left => {
    const right = b.summary.windows.find(w => w.id === left.id && w.kind === left.kind);
    if (!right) return { id: left.id, status: 'missing' };
    if (a.manifest.scenarioVersion !== b.manifest.scenarioVersion || left.caseVersion !== right.caseVersion) {
      return { id: left.id, status: 'incompatible-scenario', loadA: left.load, loadB: right.load };
    }
    const differences = {};
    for (const group of ['frame', 'hostStep', 'renderSubmit', 'gpu']) {
      differences[group] = Object.fromEntries(['median', 'p95', 'p99', 'maximum'].map(key => {
        const before = left[group]?.[key], after = right[group]?.[key];
        return [key, Number.isFinite(before) && Number.isFinite(after)
          ? { before, after, absolute: after - before, percent: before ? (after - before) / before * 100 : null } : null];
      }));
    }
    const loadChanged = JSON.stringify(left.load) !== JSON.stringify(right.load);
    return { id: left.id, status: warnings.length ? 'conditions-differ' : 'review-load-and-variance',
      loadChanged, loadA: left.load, loadB: right.load, durationA: left.durationMs, durationB: right.durationMs, differences };
  });
  for (const right of b.summary.windows.filter(w => w.kind === 'measurement')) {
    if (!cases.some(c => c.id === right.id)) cases.push({ id: right.id, status: 'added' });
  }
  return { schemaVersion: 1, warnings, cases, interpretation: 'Beobachteter Unterschied, kein Signifikanztest oder automatischer Optimierungserfolg.' };
}
