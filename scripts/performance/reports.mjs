import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { findings } from './metrics.mjs';

const number = n => Number.isFinite(n) ? n.toFixed(2) : 'nicht verfügbar';
const escape = s => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const link = (from, to) => relative(from, to).replaceAll('\\', '/');
function source(frame, outputDirectory, buildDirectory, references) {
  if (frame.snapshot) {
    const url = `${link(outputDirectory, join(buildDirectory, frame.snapshot))}#L${frame.line}`;
    if (!references.has(url)) references.set(url, `source-${references.size + 1}`);
    return `[${escape(frame.name)} (${escape(frame.snapshot.replace('source/', ''))}:${frame.line})][${references.get(url)}]`;
  }
  return `${escape(frame.name)} (${escape(frame.source || frame.url)}, ${frame.line ?? '?'}; ${frame.mapped ? 'Source-Map' : 'unaufgelöst'})`;
}

export async function writeReports(directory, manifest, summary, trace, buildDirectory) {
  await mkdir(join(directory, 'cases'), { recursive: true });
  const observations = findings(summary.windows);
  const header = `# Performance-Lab ${manifest.runId}\n\nSzenario: ${manifest.scenarioVersion}. Aufnahme: ${manifest.captureProfile}.\n\n`;
  const lines = [header, '## Beobachtungen\n', ...observations.slice(0, 8).map(f => `- **${f.type} – ${f.caseId}:** ${f.text}`)];
  if (!observations.length) lines.push('Keine regelbasierten Schwellenüberschreitungen. Dies schließt Performanceprobleme nicht aus.');
  lines.push('\n## Phasen\n', 'Frame-Statistiken gelten nur ab Initialisierung des Spielprofilers. Früher Boot wird ausschließlich im Chrome-Trace erfasst.\n', '| Phase | Dauer s | Frames | FPS | Median ms | p95 ms | p99 ms | Max ms |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const w of summary.windows) {
    lines.push(`| [${w.id}](cases/${w.id}.md) | ${number(w.durationMs / 1000)} | ${w.frame?.count ?? 0} | ${number(w.fps)} | ${number(w.frame?.median)} | ${number(w.frame?.p95)} | ${number(w.frame?.p99)} | ${number(w.frame?.maximum)} |`);
    const evidence = trace.windows.find(t => t.id === w.id);
    const caseDir = join(directory, 'cases');
    const references = new Map();
    const renderSource = frame => source(frame, caseDir, buildDirectory, references);
    const caseLines = [`# ${w.id}\n`, `Fenster: ${number(w.fromMs / 1000)}–${number(w.toMs / 1000)} s Seitenzeit. Typ: ${w.kind}.\n`,
      'Vorbereitung und Nachlauf sind eigenständige Fenster. Erstverwendung kann im aktiven Fenster liegen. CPU-Schritt, Render-Submission und GPU-Zeit werden getrennt beurteilt.\n',
      `Erster erfasster Frame: ${number(w.coverageStartMs == null ? null : w.coverageStartMs / 1000)} s Seitenzeit; bei fehlenden Frames sind Messwerte nicht verfügbar.\n`,
      '| Messgröße | Median ms | p95 ms | p99 ms | Maximum ms |', '|---|---:|---:|---:|---:|'];
    for (const key of ['frame', 'hostStep', 'renderSubmit', 'gpu']) caseLines.push(`| ${key} | ${number(w[key]?.median)} | ${number(w[key]?.p95)} | ${number(w[key]?.p99)} | ${number(w[key]?.maximum)} |`);
    caseLines.push(`\nGPU-Status: ${w.gpuStatus}. Host-Schritt ist nicht die gesamte Hauptthread-Arbeit.\n`, '## Tatsächliche Last\n',
      '`actions` zählt akzeptierte Aktionsaufrufe; bei gehaltenen Waffen einschließlich Hold-Updates, nicht einzelne Schüsse. Treffer, Projektilspitzen und Folgeeffekte separat prüfen.\n',
      '```json', JSON.stringify(w.load, null, 2), '```',
      '\n## Budgetüberschreitungen\n', '```json', JSON.stringify(w.overBudget, null, 2), '```', '\n## Stärkste Frame-Abstände\n',
      '| Seitenzeit s | Abstand ms | Gegner | Projektile | überlappende GC-Ereignisse |', '|---|---:|---:|---:|---:|');
    for (const spike of evidence?.spikes ?? []) caseLines.push(`| ${number(spike.atMs / 1000)} | ${number(spike.durationMs)} | ${spike.enemies} | ${spike.projectiles} | ${spike.gc.length} |`);
    for (const spike of evidence?.spikes.slice(0, 3) ?? []) {
      caseLines.push(`\n### Detailfenster bis ${number(spike.atMs / 1000)} s\n`,
        `Überlappende Spielereignisse: ${spike.events?.map(e => escape(e.type)).join(', ') || 'keine'}.\n`);
      for (const thread of spike.threads ?? []) {
        caseLines.push(`**${escape(thread.name)}:**\n`);
        for (const stack of thread.stacks.slice(0, 3)) caseLines.push(`- ${number(stack.ms)} ms: ${stack.frames.slice(0, 12).map(renderSource).join(' ← ')}${stack.frames.length > 12 ? ' ← … (vollständig in evidence.json)' : ''}`);
      }
    }
    for (const burst of evidence?.recurringSpikes ?? []) {
      caseLines.push(`\n### Gehäufte Spitzen ${number(burst.fromMs / 1000)}–${number(burst.toMs / 1000)} s\n`,
        `${burst.count} Frame-Abstände über ${number(burst.thresholdMs)} ms. Zeitliche Häufung beweist keine Periodizität.\n`);
      for (const thread of burst.threads) {
        caseLines.push(`**${escape(thread.name)}:**\n`);
        for (const f of thread.self.slice(0, 3)) caseLines.push(`- ${renderSource(f)}: ${number(f.ms)} ms gesampelte Eigenzeit`);
      }
    }
    for (const thread of evidence?.threads ?? []) {
      caseLines.push(`\n## ${thread.role === 'main' ? 'Hauptthread' : 'Worker'}: ${escape(thread.name)} (${thread.pid}:${thread.tid})\n`, `Gesampelt: ${number(thread.sampledMs)} ms; unbekannte Knoten: ${number(thread.unknownMs)} ms; JS ohne Source-Map: ${number(thread.unresolvedJsMs)} ms.\n`,
        `Profilerzustände, getrennt von Funktionen: ${Object.entries(thread.states ?? {}).map(([key, ms]) => `${key} ${number(ms)} ms`).join('; ') || 'keine'}. Anteile beziehen sich auf die gesamte gesampelte Zeit einschließlich Leerlauf.\n`);
      for (const [key, label] of [['self', 'Eigenzeit'], ['inclusive', 'Inklusive Zeit']]) {
        caseLines.push(`### ${label}\n`, '| Funktion und Quellstelle | Geschätzte ms | Anteil % |', '|---|---:|---:|');
        for (const f of thread[key].slice(0, 12)) caseLines.push(`| ${renderSource(f)} | ${number(f.ms)} | ${number(f.percent)} |`);
      }
      caseLines.push('\n### Häufigste Aufrufketten\n');
      for (const stack of thread.stacks.slice(0, 5)) caseLines.push(`- ${number(stack.ms)} ms: ${stack.frames.slice(0, 12).map(renderSource).join(' ← ')}${stack.frames.length > 12 ? ' ← … (vollständig in evidence.json)' : ''}`);
    }
    const repeatCase = summary.windows.find(candidate => candidate.caseVersion !== undefined
      && (w.id === candidate.id || w.id.startsWith(`${candidate.id}.`)))?.id ?? manifest.caseId;
    caseLines.push('\n## Wiederholung\n', '```text', `npm run perf:chrome -- --case ${repeatCase}${manifest.durationMs ? ` --duration-seconds ${manifest.durationMs / 1000}` : ''} --timeout-seconds ${manifest.timeoutMs / 1000}${manifest.captureProfile === 'reduced' ? ' --capture-profile reduced' : ''}`, '```');
    caseLines.push('', ...[...references].map(([url, id]) => `[${id}]: ${url}`));
    await writeFile(join(caseDir, `${w.id}.md`), caseLines.join('\n'));
  }
  lines.push('\nKeine automatische Ursachenbestimmung. Bildschirmtakt/VSync, Erstverwendung, tatsächliche Last und Messstreuung berücksichtigen.');
  await writeFile(join(directory, 'summary.md'), lines.join('\n'));
  await writeFile(join(directory, 'analysis.md'), [header, 'Lies zuerst [summary.md](summary.md), danach die verlinkten Fallberichte. Alle Auswertungen wurden bereits durch den Runner ausgeführt; die KI braucht keine Skriptausführung.\n',
    `Quellstand: ${manifest.sourceHash}; Commit: ${manifest.commit}. Der unveränderliche [Quellstand](${link(directory, join(buildDirectory, 'source'))}) gehört exakt zur Aufnahme.\n`,
    `Messbedingungen: Chrome ${manifest.browserVersion}; Aufnahmeprofil ${manifest.captureProfile} v${manifest.captureProfileVersion}. Hardware, Renderauflösung, Szenariodaten-Hash und Startparameter stehen im [Manifest](manifest.json). Für Vorher/Nachher müssen Fallversion und Bedingungen passen; verschiedene Quellstände sind erlaubt.\n`,
    '## Priorisierte Beobachtungen\n', ...observations.slice(0, 5).map(f => `- **${f.type}:** [${f.caseId}](cases/${f.caseId}.md) – ${f.text}`),
    'Untersuchungsauftrag: Beobachtung und Ursache trennen; auffällige Aufrufketten im passenden Quellstand prüfen; eine begründete Änderung und den kleinsten aussagekräftigen Wiederholungstest vorschlagen. Nach der Änderung führt der Mensch den Test und perf:compare aus.\n',
    ...trace.notes.map(n => `- ${n}`), '\nOriginaldaten: [Spieltrace](fragdachse-trace.json), [Chrome-Trace](chrome-trace.json.gz), [aufbereitete Belege](evidence.json).'].join('\n'));
  await writeFile(join(directory, 'summary.json'), JSON.stringify({ ...summary, findings: observations }, null, 2));
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(trace));
}
