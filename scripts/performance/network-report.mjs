import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { metric, summarizeWindows } from './metrics.mjs';

export function checkProbePair(host, client) {
  if (host.role !== 'host' || client.role !== 'client') throw new Error('Reihenfolge: Host-Datei, Client-Datei');
  for (const key of ['schemaVersion', 'experiment', 'room', 'roundStart', 'quality', 'buildSignature', 'cooldownMs'])
    if (host[key] !== client[key] || host[key] == null) throw new Error(`Unterschiedliche Messung: ${key}`);
  if (host.schemaVersion !== 1 || host.experiment !== 'p90-bubble-1') throw new Error('Unbekanntes Experiment');
  if (host.error || client.error) throw new Error(`Abgebrochener Lauf: ${host.error ?? client.error}`);
}

export function summarizeProbe(result) {
  const origin = result.game?.frameCapture?.startedAtPerformanceMs;
  const windows = summarizeWindows(result).filter(w => w.kind !== 'preparation');
  return windows.map(w => {
    const inside = at => at >= w.fromMs && at < w.toMs;
    const samples = result.samples.filter(s => inside(s.atMs));
    const first = samples[0], last = samples.at(-1), link = last?.links[0];
    const series = result.game.series.samples.filter(s => inside(s.atMs + origin)
      && s.atMs + origin - result.game.series.sampleIntervalMs >= w.fromMs);
    const total = key => series.reduce((n, s) => n + (s.interval[key] ?? 0), 0);
    const updates = result.updates.filter(inside);
    const times = [w.fromMs, ...updates, w.toMs];
    const shots = result.role === 'host' ? Number(w.load.shots ?? 0) : null;
    const errors = [];
    if (!w.frame || samples.length < 2 || !link) errors.push('Messdaten fehlen');
    if (result.role === 'client' && updates.length < 2) errors.push('Keine laufenden Zustandsupdates');
    if (result.role === 'host' && ['p90', 'p90-bubble'].includes(w.id)) {
      if (shots < w.durationMs / result.cooldownMs * .7) errors.push('Schusslast unterschritten');
      if (!samples.some(s => s.projectiles > 0) || !(w.load.hits > 0)) errors.push('Projektile oder Treffer fehlen');
      if (w.id === 'p90-bubble' && (!samples.some(s => s.timeBubbles > 0) || !samples.some(s => s.prismShots > 0))) errors.push('TimeBubble/Prismengeschosse fehlen');
    }
    const span = last && first ? (last.atMs - first.atMs) / 1000 : 0;
    return { phase: w.id, errors, frameP95Ms: w.frame?.p95 ?? null,
      gameStepP95Ms: metric(result.game.frameCapture.frames.filter(f => inside(f[1] + origin) && Number.isFinite(f[3])).map(f => f[3]))?.p95 ?? null,
      renderP95Ms: w.renderSubmit?.p95 ?? null,
      snapshotMeanMs: result.role === 'host' && total('logicalSnapshotCount') > 0 ? total('snapshotBuildTotalMs') / total('logicalSnapshotCount') : null,
      sentKiBs: span > 0 ? (link.bytesSent - first.links[0].bytesSent) / span / 1024 : null,
      nativeBufferMaxBytes: samples.length ? Math.max(...samples.map(s => s.links[0].reliableBufferedBytes + s.links[0].fastBufferedBytes)) : null,
      rtcMedianMs: link?.medianRttMs ?? null, appMedianMs: link?.medianAppPingMs ?? null,
      updateGapMaxMs: result.role === 'client' ? metric(times.slice(1).map((t, i) => t - times[i]))?.maximum ?? null : null,
      projectilePeak: samples.length ? Math.max(...samples.map(s => s.projectiles)) : null, shots };
  });
}

export function probeMarkdown(host, client) {
  checkProbePair(host, client);
  const reports = [host, client].map(result => ({ role: result.role, phases: summarizeProbe(result) }));
  const n = value => value == null ? '—' : value.toFixed(1);
  return { valid: reports.every(r => r.phases.every(p => !p.errors.length)),
    markdown: `# P90-/TimeBubble-Diagnose (${host.quality})\n\n`
      + `Auflösung: Host ${host.viewport.width}×${host.viewport.height}, Client ${client.viewport.width}×${client.viewport.height}.\n\n`
      + reports.map(r => `## ${r.role}\n\n| Phase | Frame p95 ms | Spielschritt p95 ms | Render p95 ms | Snapshot Ø ms | Versand KiB/s | Puffer max KiB | RTC / App Median ms | Update-Lücke max ms | Projektile Spitze | Schüsse |\n`
        + '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n'
        + r.phases.map(p => `| ${p.phase} | ${n(p.frameP95Ms)} | ${n(p.gameStepP95Ms)} | ${n(p.renderP95Ms)} | ${n(p.snapshotMeanMs)} | ${n(p.sentKiBs)} | ${n(p.nativeBufferMaxBytes == null ? null : p.nativeBufferMaxBytes / 1024)} | ${n(p.rtcMedianMs)} / ${n(p.appMedianMs)} | ${n(p.updateGapMaxMs)} | ${n(p.projectilePeak)} | ${r.role === 'host' ? n(p.shots) : '—'} |`).join('\n')
        + '\n\n' + r.phases.flatMap(p => p.errors.map(e => `- Ungültig: ${r.role}/${p.phase}: ${e}`)).join('\n')).join('\n\n')
      + '\n\nKein Lag-frei-Prädikat. RTC/App sind die vorhandenen gleitenden Mediane am Phasenende; Versand und native Puffer stammen aus RTC-Diagnosen mit 1-s-Abtastung. Update-Lücken messen neu beobachtete Zustände, keine Einweg-Latenz. Snapshot Ø umfasst den vorhandenen Host-Publikationspfad. Für Grafikvergleiche gleiche Auflösung, Hardware und tatsächlich erreichte Last prüfen; einzelne p95-Werte nicht addieren.\n' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [host, client] = process.argv.slice(2);
  if (!host || !client) throw new Error('npm run perf:network:report -- <host.json> <client.json>');
  const results = await Promise.all([host, client].map(p => readFile(p, 'utf8').then(JSON.parse)));
  const report = probeMarkdown(...results); console.log(report.markdown);
  if (!report.valid) process.exitCode = 1;
}
