import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { metric } from './metrics.mjs';

export const LOAD_VIEWPORT = { width: 1664, height: 936 };
export const LOAD_NETWORKS = {
  local: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  '50mbps': { offline: false, latency: 20, downloadThroughput: 50_000_000 / 8, uploadThroughput: 50_000_000 / 8 },
};

// Only installed by the runner. No rAF probe or recording in the shipped game.
export function installLoadProbe() {
  const times = [], hidden = [];
  let truncated = false;
  function frame(at) {
    if (times.length < 250_000) times.push(at); else truncated = true;
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => hidden.push({ at: performance.now(), hidden: document.hidden }));
  hidden.push({ at: performance.now(), hidden: document.hidden });
  requestAnimationFrame(frame);
  window.__FD_LOAD_PROBE__ = {
    read: (from, to) => ({ times: times.filter(at => at >= from && at <= to),
      hidden: hidden.filter((e, i) => e.at <= to && (e.at >= from || i === hidden.findLastIndex(v => v.at <= from))),
      truncated, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } }),
  };
}

export function rafEvidence(probe, from, to) {
  const times = probe.times.filter(t => t >= from && t <= to);
  const deltas = times.slice(1).map((t, i) => t - times[i]).filter(t => t > 0);
  const intervals = metric(deltas);
  const medianFps = intervals ? 1000 / intervals.median : null;
  const errors = [];
  if (medianFps === null || deltas.length < 3) errors.push('Insufficient rAF samples');
  else if (medianFps < 20) errors.push('Median rAF below 20 fps: throttled or overloaded');
  if (probe.truncated) errors.push('rAF capture truncated');
  if (probe.hidden.some(e => e.hidden)) errors.push('Document hidden during loading');
  if (probe.viewport.width !== LOAD_VIEWPORT.width || probe.viewport.height !== LOAD_VIEWPORT.height || probe.viewport.dpr !== 1) errors.push('Viewport/DPR changed');
  return { medianFps, intervalsMs: intervals, frames: times.length,
    effectiveFps: to > from ? times.length * 1000 / (to - from) : null,
    initialGapMs: times.length ? times[0] - from : to - from,
    finalGapMs: times.length ? to - times.at(-1) : to - from, errors };
}

export function summarizeLoadSamples(samples) {
  const phases = [...new Set(samples.map(s => s.phase))];
  return phases.map(phase => {
    const all = samples.filter(s => s.phase === phase), valid = all.filter(s => s.valid);
    const values = field => metric(valid.map(s => s[field]));
    const groupNames = [...new Set(valid.flatMap(s => s.resources.groups.map(g => g.group)))];
    const sectionNames = [...new Set(valid.flatMap(s => s.sections.map(g => `${g.scope}/${g.kind}/${g.name}`)))];
    return { phase, samples: all.length, valid: valid.length, invalid: all.length - valid.length,
      commandToRevealMs: values('commandToRevealMs'), commandToPlayableMs: values('commandToPlayableMs'), bootRevealMs: values('bootRevealMs'),
      worldReadyMs: values('worldReadyMs'), worldRevealMs: values('worldRevealMs'),
      rafMedianFps: metric(valid.map(s => s.raf.medianFps)),
      lastFulfilled: all.map(s => ({ iteration: s.iteration, valid: s.valid, gates: s.lastFulfilled })),
      downloads: groupNames.map(group => ({ group, ...Object.fromEntries(
        ['requests', 'transferBytes', 'encodedBytes', 'decodedBytes', 'wallSpanMs', 'requestMs', 'zeroTransfer'].map(key =>
          [key, metric(valid.map(s => s.resources.groups.find(g => g.group === group)?.[key] ?? 0))])) })),
      topSections: sectionNames.map(id => ({ id, durationMs: metric(valid.map(s => s.sections
        .filter(g => `${g.scope}/${g.kind}/${g.name}` === id).reduce((n, g) => n + g.totalMs, 0))) }))
        .sort((a, b) => b.durationMs.median - a.durationMs.median).slice(0, 15),
    };
  });
}

export async function writeLoadReports(directory, request, samples) {
  const report = { schemaVersion: 1, mode: 'load', buildMode: 'performance-lab production bundle',
    viewport: LOAD_VIEWPORT, quality: 'high', network: { name: request.network, ...LOAD_NETWORKS[request.network] },
    iterations: request.runs, samples, phases: summarizeLoadSamples(samples),
    notes: [
      'Cold = cleared Chrome HTTP/origin cache, not cold OS/GPU/driver cache. Warm = same context, page reload.',
      'Maps 1/7/15 use ordinary host ready/start/discard through the existing lab port; no combat fixtures or Vite.',
      'Command-to-playable includes normal round countdown. World-ready is the A1 local barrier; reveal eligibility is polled at 100 ms.',
      'rAF validity covers construction through both readiness and reveal eligibility, excluding subsequent countdown/idle/report work.',
      'Boot-reveal includes initial module/network startup and DOM fade; A1 boot starts later at asset preload.',
      'CPU/worker/elapsed sections overlap and must not be summed. Resource Timing bytes exclude worker child imports.',
      'Invalid samples are retained but excluded from every median/p95. No heavy tracing or scenario frame recording.',
    ] };
  await writeFile(join(directory, 'load-summary.json'), JSON.stringify(report, null, 2));
  const pair = m => m ? `${m.median.toFixed(1)} / ${m.p95.toFixed(1)}` : '—';
  const lines = ['# Ladezeitmessung', '', `Build: performance-lab (Produktionsbundle), high, 1664×936, DPR 1; Netzwerk: ${request.network}.`, '',
    'Alle Zeitspalten: Median / p95 in ms; nur gültige Stichproben.', '',
    '| Phase | gültig / gesamt | Boot-Reveal | World-Ready | World-Reveal | Auftrag → Reveal | Auftrag → spielbar | rAF fps |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...report.phases.map(p => `| ${p.phase} | ${p.valid} / ${p.samples} | ${pair(p.bootRevealMs)} | ${pair(p.worldReadyMs)} | ${pair(p.worldRevealMs)} | ${pair(p.commandToRevealMs)} | ${pair(p.commandToPlayableMs)} | ${pair(p.rafMedianFps)} |`), ''];
  for (const phase of report.phases) {
    lines.push(`## ${phase.phase}`, '', '| Downloadgruppe | Transferbytes med/p95 | HTTP-Bodybytes med/p95 | Wall-Span ms med/p95 |', '|---|---:|---:|---:|',
      ...phase.downloads.map(g => `| ${g.group} | ${pair(g.transferBytes)} | ${pair(g.encodedBytes)} | ${pair(g.wallSpanMs)} |`), '',
      '| Abschnitt (verschachtelt/überlappend) | ms med/p95 |', '|---|---:|',
      ...phase.topSections.slice(0, 8).map(s => `| ${s.id} | ${pair(s.durationMs)} |`), '',
      `Letzte Barrieren: ${phase.lastFulfilled.map(s => `${s.iteration}: ${s.gates.join(', ') || 'keine'}`).join('; ')}`, '');
  }
  lines.push('## Hinweise', '', ...report.notes.map(n => `- ${n}`), '',
    ...samples.filter(s => !s.valid).map(s => `- UNGÜLTIG ${s.iteration}/${s.phase}: ${s.errors.join('; ')}`), '');
  await writeFile(join(directory, 'load-summary.md'), lines.join('\n'));
  return report;
}

/** Uses the runner's owned server/context/abort lifetime. Saves every phase before the next navigation. */
export async function runLoadMeasurements({ page, context, url, directory, request, signal }) {
  signal.throwIfAborted();
  const cdp = await context.newCDPSession(page);
  const samples = [];
  const poll = async predicate => {
    const deadline = Date.now() + Math.min(request.timeoutMs, 300_000);
    for (;;) {
      signal.throwIfAborted();
      const failure = await page.evaluate(() => window.__FD_PERF__?.error || window.__FD_BOOT__?.error);
      if (failure) throw new Error(failure);
      if (await predicate()) return;
      if (Date.now() >= deadline) throw new Error('Load phase exceeded 300 s; see last timeline');
      await new Promise(done => setTimeout(done, 100));
    }
  };
  const save = async (iteration, phase, from, boot, revealAt) => {
    const raw = await page.evaluate(({ from, boot, revealAt }) => {
      const timeline = window.__FD_BOOT__.timeline();
      const reveal = boot ? performance.getEntriesByType('mark').find(e => e.name.endsWith(':lobby-revealed'))?.startTime : revealAt;
      if (reveal === undefined) throw new Error('Missing lobby reveal marker');
      const world = timeline.runs.filter(r => r.scope === 'world' && r.startedAt >= from).at(-1);
      const to = Math.max(reveal, world ? world.startedAt + world.durationMs : reveal);
      return { timeline, from, to, revealAt: reveal, playableAt: boot ? reveal : performance.now(), raf: window.__FD_LOAD_PROBE__.read(from, to),
        navigation: performance.getEntriesByType('navigation').map(e => e.toJSON()),
        resources: performance.getEntriesByType('resource').filter(e => e.startTime >= from && e.startTime <= to).map(e => e.toJSON()) };
    }, { from, boot, revealAt });
    const runs = raw.timeline.runs.filter(r => r.startedAt >= from && r.startedAt <= raw.to);
    const world = runs.filter(r => r.scope === 'world').at(-1);
    const raf = rafEvidence(raw.raf, from, raw.to);
    const errors = [...raf.errors];
    if (!world || !['ready', 'revealed'].includes(world.outcome)) errors.push('Missing completed world timeline');
    const sample = { iteration, phase, valid: !errors.length, errors,
      commandToRevealMs: raw.revealAt - from, commandToPlayableMs: raw.playableAt - from, bootRevealMs: boot ? raw.revealAt : undefined,
      worldReadyMs: world?.durationMs, worldRevealMs: world ? raw.revealAt - world.startedAt : undefined,
      raf, lastFulfilled: runs.map(r => `${r.scope}:${r.criticalPath.lastFulfilled ?? 'none'}`),
      sections: runs.flatMap(r => r.topSections.map(s => ({ scope: r.scope, ...s }))),
      // Boot includes imports before BootScreen.begin; switches exclude earlier cached boot transfers.
      resources: boot ? raw.timeline.resources : world?.resources ?? { groups: [] } };
    // Raw timeline + phase-local raw resources preserve evidence for other attribution/grouping.
    await writeFile(join(directory, `load-${String(iteration).padStart(2, '0')}-${phase}.json`), JSON.stringify({ sample, ...raw }, null, 2));
    samples.push(sample);
    await writeLoadReports(directory, request, samples);
    console.log(`Load ${iteration}/${request.runs} ${phase}: ${(sample.commandToRevealMs / 1000).toFixed(2)} s, rAF ${raf.medianFps?.toFixed(1) ?? '?'} fps${sample.valid ? '' : ' INVALID'}`);
  };
  try {
    await context.addInitScript(installLoadProbe);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.emulateNetworkConditions', LOAD_NETWORKS[request.network]);
    for (let iteration = 1; iteration <= request.runs; iteration++) {
      signal.throwIfAborted();
      await page.goto('about:blank');
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'all' });
      for (const phase of ['cold-lobby', 'warm-lobby']) {
        if (phase === 'cold-lobby') await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        else {
          // Reload as a fresh host, not as a client joining the previous host's room hash.
          await page.evaluate(url => history.replaceState(null, '', url), url);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        }
        await page.bringToFront();
        await poll(() => page.evaluate(() => window.__FD_PERF__?.state === 'awaiting-audio'));
        await save(iteration, phase, 0, true);
      }
      await page.mouse.click(4, 4);
      await poll(() => page.evaluate(() => window.__FD_PERF__?.audioState?.() === 'running'));
      await page.evaluate(async () => {
        if (!window.__FD_PERF__?.prepareLoad) throw new Error('Archived build does not support --load; build current sources');
        await window.__FD_PERF__.prepareLoad();
      });
      for (const map of ['1', '7', '15']) {
        await poll(() => page.evaluate(() => window.__FD_PERF__.load.status().lobbyReady));
        const from = await page.evaluate(map => { const at = performance.now(); window.__FD_PERF__.load.start(map); return at; }, map);
        let revealAt;
        await poll(async () => {
          const state = await page.evaluate(() => ({ ...window.__FD_PERF__.load.status(), at: performance.now() }));
          const matches = state.worldId?.endsWith(':' + map);
          if (matches && state.revealReady) revealAt ??= state.at;
          return matches && state.ready && state.revealReady;
        });
        await save(iteration, `map-${map}`, from, false, revealAt);
        await page.evaluate(() => window.__FD_PERF__.load.lobby());
      }
      await poll(() => page.evaluate(() => window.__FD_PERF__.load.status().lobbyReady));
    }
    return await writeLoadReports(directory, request, samples);
  } catch (error) {
    try {
      const partial = await page.evaluate(() => ({ timeline: window.__FD_BOOT__?.timeline(), status: window.__FD_PERF__?.detail }));
      await writeFile(join(directory, 'load-failed-timeline.json'), JSON.stringify(partial, null, 2));
    } catch { /* The renderer can already be gone; previous samples remain on disk. */ }
    throw error;
  } finally { await cdp.detach().catch(() => {}); }
}
