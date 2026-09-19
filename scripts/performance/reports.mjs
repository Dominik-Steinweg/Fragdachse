import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { findings, COST_SCOPES } from './metrics.mjs';

const number = n => Number.isFinite(n) ? n.toFixed(2) : 'nicht verfügbar';
const seconds = ms => Number.isFinite(ms) ? (ms / 1000).toFixed(3) : 'nicht verfügbar';
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

function stackDescription(stack, renderSource) {
  const head = stack.frames.slice(0, 12).map(renderSource).join(' ← ');
  if (stack.frames.length <= 12) return head;
  const project = stack.frames.slice(12).filter(f => f.snapshot?.startsWith('source/src/')).slice(0, 6);
  return head + ' ← … (vollständig in evidence.json)' + (project.length
    ? `; weitere Projekt-Aufrufer derselben Kette (Zwischenaufrufe ausgelassen): ${project.map(renderSource).join(' ← ')}` : '');
}

export async function writeReports(directory, manifest, summary, trace, buildDirectory) {
  await mkdir(join(directory, 'cases'), { recursive: true });
  const observations = findings(summary.windows);
  const header = `# Performance-Lab ${manifest.runId}\n\nSzenario: ${manifest.scenarioVersion}. Aufnahme: ${manifest.captureProfile}.\n\n`;
  const lines = [header, '## Beobachtungen\n', ...observations.slice(0, 8).map(f => `- **${f.type} – ${f.caseId}:** ${f.text}`)];
  if (!observations.length) lines.push('Keine regelbasierten Schwellenüberschreitungen. Dies schließt Performanceprobleme nicht aus.');
  lines.push('\n## Messzuordnung\n', 'Frame-Statistiken verwenden nur vollständig enthaltene, ungekürzte Intervalle. Grenzintervalle bleiben separat sichtbar und sind über Frame-ID phasenübergreifend identifizierbar. Keine ersten Frames werden pauschal verworfen. FPS beschreibt den Takt dieser enthaltenen Intervalle, keine CPU-Auslastung. Früher Boot besitzt nur Chrome-Daten.\n',
    '\n## Phasen\n', '| Phase | Dauer s | Intervalle | FPS | Median ms | p95 ms | p99 ms | Max ms | Grenzintervalle / längstes ms |', '|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const w of summary.windows) {
    lines.push(`| [${w.id}](cases/${w.id}.md) | ${number(w.durationMs / 1000)} | ${w.frame?.count ?? 0} | ${number(w.fps)} | ${number(w.frame?.median)} | ${number(w.frame?.p95)} | ${number(w.frame?.p99)} | ${number(w.frame?.maximum)} | ${w.boundaryIntervals.length} / ${number(w.boundaryFrame?.maximum)} |`);
    const evidence = trace.windows.find(t => t.id === w.id);
    const caseDir = join(directory, 'cases');
    const references = new Map();
    const renderSource = frame => source(frame, caseDir, buildDirectory, references);
    const caseLines = [`# ${w.id}\n`, `Fenster: ${number(w.fromMs / 1000)}–${number(w.toMs / 1000)} s Seitenzeit. Typ: ${w.kind}.\n`,
      'Frame-Delta beschreibt das vorausgehende Intervall; die Arbeit desselben rAF-Callbacks liegt danach. Beide werden anhand ihrer eigenen Zeitgrenzen zugeordnet. Grenzübergreifende Intervalle werden weder gekürzt noch vollständig dem neuen Fenster zugeschlagen. Echte Erstverwendung innerhalb dieses Fensters bleibt in der Statistik.\n',
      `Erster erfasster Frame: ${number(w.coverageStartMs == null ? null : w.coverageStartMs / 1000)} s Seitenzeit; bei fehlenden Frames sind Messwerte nicht verfügbar.\n`,
      '| Messgröße | Median ms | p95 ms | p99 ms | Maximum ms |', '|---|---:|---:|---:|---:|'];
    for (const key of ['frame', 'hostStep', 'renderSubmit', 'gpu']) caseLines.push(`| ${key} | ${number(w[key]?.median)} | ${number(w[key]?.p95)} | ${number(w[key]?.p99)} | ${number(w[key]?.maximum)} |`);
    caseLines.push(`\nGPU-Status: ${w.gpuStatus}. GPU-Abfragen werden über ihr auslösendes CPU-Submission-Intervall zugeordnet, nicht über den Zeitpunkt des Ergebnisabrufs. Die tatsächliche Ausführungszeit auf der GPU besitzt hier keine synchronisierte Zeitachse. GPU erfasst nur PRE_RENDER–POST_RENDER; früheres Offscreen-Rendering ist darin nicht enthalten. ${w.gpuBoundary.length} grenzübergreifende GPU-Abfragen separat in summary.json.\n`,
      '## Phasengrenzen\n', '| Frame-ID | Vollständiges Intervall s | Voller Abstand ms | Überlappung hier ms | Betroffene Phasen |', '|---|---|---:|---:|---|');
    for (const b of w.boundaryIntervals) caseLines.push(`| ${b.frameId} | ${seconds(b.fromMs)}–${seconds(b.toMs)} | ${number(b.durationMs)} | ${number(b.overlapMs)} | ${escape(b.phaseIds.join(', '))} |`);
    caseLines.push('\n## Hauptthread-Arbeit\n', 'Gemessene Wall-Zeit innerhalb synchroner Aufrufe, einschließlich GC, Treiberwartezeit und möglicher OS-Unterbrechungen; keine CPU-Auslastung. Übergeordnete und enthaltene Zeiten NICHT addieren. SceneManager umfasst auch andere Scenes; Arena-Teilbereiche sind darin enthalten. Manuelle Host-Physik liegt im Gameplay-Bereich, automatische Phaser-Physik in den Scene-Systemen.\n',
      '| Bereich | Enthalten in | Messungen | Median ms | p95 ms | Maximum ms |', '|---|---|---:|---:|---:|---:|');
    for (const [key, [label, parent]] of Object.entries(COST_SCOPES)) {
      const m = w.costs.scopes[key];
      caseLines.push(`| ${label} | ${parent ? COST_SCOPES[parent][0] : '–'} | ${m?.count ?? 0} | ${number(m?.median)} | ${number(m?.p95)} | ${number(m?.maximum)} |`);
    }
    caseLines.push('\nJeder Bereich wird nach seinen eigenen Grenzen ausgewählt: Ein Kind kann vollständig enthalten sein, während sein Elternaufruf eine Phasengrenze kreuzt. Deshalb können die Stichproben verschieden sein; Maxima oder Percentile verschiedener Zeilen ergeben keine Zeitbilanz. Die Hängerdetails zeigen zusammengehörige konkrete Aufrufe.\n');
    caseLines.push(`\n${w.costs.boundarySpans.length} CPU-Bereiche kreuzen die Phasengrenze; ${w.costs.partialCallbacks.length} Callbacks nur teilweise erfasst. Nicht in diese Bereichsstatistiken eingerechnet; ungeteilte Dauern und Grenzen stehen in summary.json.\n`,
      '## Renderzähler\n', `Messumfang: ${w.renderCounterScope}\n`,
      '| Größe pro vollständig enthaltenem Callback | Median | p95 | Maximum |', '|---|---:|---:|---:|',
      `| GL-Zeichenaufrufe | ${number(w.drawCalls?.median)} | ${number(w.drawCalls?.p95)} | ${number(w.drawCalls?.maximum)} |`,
      `| Davon mit Offscreen-Framebuffer | ${number(w.offscreenDrawCalls?.median)} | ${number(w.offscreenDrawCalls?.p95)} | ${number(w.offscreenDrawCalls?.maximum)} |`,
      '\nAufrufe zählen API-Submissions, keine sichtbaren Objekte, Dreiecke oder erfolgreiche GPU-Arbeit. Nicht unterstützte/ungültige Messungen sind nicht verfügbar; eine gültig beobachtete Null bleibt Null.\n',
      '## Verlauf in kurzen Abschnitten\n', '| Seitenzeit s | FPS | Median / p95 / Max ms | Gegner Median / Max | Projektile Median / Max | Grenzintervalle |', '|---|---:|---|---|---|---:|');
    for (const s of w.sections) caseLines.push(`| ${seconds(s.fromMs)}–${seconds(s.toMs)} | ${number(s.fps)} | ${number(s.frame?.median)} / ${number(s.frame?.p95)} / ${number(s.frame?.maximum)} | ${number(s.enemies?.median)} / ${number(s.enemies?.maximum)} | ${number(s.projectiles?.median)} / ${number(s.projectiles?.maximum)} | ${s.boundaryCount} |`);
    caseLines.push('\nZähler stammen aus dem vorhergehenden Spiel-Update, das zum jeweiligen Frame-Intervall gehört. Abschnittsgrenzen teilen keine Hänger. Änderungen im Verlauf sind Beobachtungen; steigende Bestände beweisen keine Ursache.\n',
      '## Messgrenzen dieses Fensters\n', ...(w.issues.length ? w.issues.map(s => `- ${s}`) : ['Keine zusätzlichen Messprobleme erkannt.']), '\n## Tatsächliche Last\n',
      '`actions` zählt akzeptierte Aktionsaufrufe; bei gehaltenen Waffen einschließlich Hold-Updates, nicht einzelne Schüsse. Treffer, Projektilspitzen und Folgeeffekte separat prüfen.\n',
      '```json', JSON.stringify(w.load, null, 2), '```',
      '\n## Budgetüberschreitungen\n', '```json', JSON.stringify(w.overBudget, null, 2), '```', '\n## Stärkste Frame-Abstände\n',
      '| Seitenzeit s | Abstand ms | Gegner | Projektile | überlappende GC-Ereignisse |', '|---|---:|---:|---:|---:|');
    for (const spike of evidence?.spikes ?? []) caseLines.push(`| ${number(spike.atMs / 1000)} | ${number(spike.durationMs)} | ${spike.enemies} | ${spike.projectiles} | ${spike.gc.length} |`);
    for (const spike of evidence?.spikes.slice(0, 3) ?? []) {
      caseLines.push(`\n### Detailfenster ${number(spike.fromMs / 1000)}–${number(spike.atMs / 1000)} s, Frame-ID ${spike.frameId}\n`,
        `${spike.crossesPhase ? 'Grenzüberschreitend; vollständig in mehreren betroffenen Berichten sichtbar, kein mehrfaches Ereignis.' : 'Vollständig innerhalb dieser Phase.'} ${(spike.work?.outsideCapturedCallbacksMs ?? 0).toFixed(2)} ms außerhalb erfasster Spiel-Callbacks; das kann Browserarbeit, Warten oder Scheduling sein und ist kein Idle-/CPU-Beweis.\n`,
        `Überlappende Spielereignisse: ${spike.events?.map(e => escape(e.type)).join(', ') || 'keine'}.\n`);
      caseLines.push('| Überlappender gemessener Bereich | Volle Dauer ms | Zeit s | Intervallgrenze überschritten |', '|---|---:|---|---|');
      for (const c of (spike.work?.scopes ?? []).sort((a, b) => b.durationMs - a.durationMs).slice(0, 16)) caseLines.push(`| ${COST_SCOPES[c.scope]?.[0] ?? c.scope} | ${number(c.durationMs)} | ${number(c.fromMs / 1000)}–${number(c.toMs / 1000)} | ${c.crossesInterval ? 'ja' : 'nein'} |`);
      caseLines.push('\nDiese Bereiche sind verschachtelt. Nachfolgende Aufrufketten sind Sampling-Belege im vollständigen Hängerintervall. Gleichzeitige Worker-/GC-Aktivität sowie gesampelter Idle-Zustand sind allein keine Ursache.\n');
      for (const thread of spike.threads ?? []) {
        caseLines.push(`**${escape(thread.name)}:**\n`);
        for (const stack of thread.stacks.slice(0, 3)) caseLines.push(`- ${number(stack.ms)} ms: ${stackDescription(stack, renderSource)}`);
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
      caseLines.push('\n### Projekt-Hotspots\n',
        'Separat vor der Top-Limitierung ausgewählt, damit Engine-Aufrufe die Projektfunktionen nicht verdrängen. Inklusive Zeit enthält aufgerufene Bibliotheken; Anteile beziehen sich weiterhin auf die gesamte Thread-Stichprobe. Diese Tabellen sind alternative Ansichten derselben Samples und nicht addierbar.\n');
      for (const [key, label] of [['projectSelf', 'Projekt-Eigenzeit'], ['projectInclusive', 'Projekt inklusive Aufrufen']]) {
        caseLines.push(`#### ${label}\n`, '| Funktion und Quellstelle | Geschätzte ms | Anteil % |', '|---|---:|---:|');
        for (const f of thread[key] ?? []) caseLines.push(`| ${renderSource(f)} | ${number(f.ms)} | ${number(f.percent)} |`);
      }
      caseLines.push('\n### Häufigste Aufrufketten\n');
      for (const stack of thread.stacks.slice(0, 5)) caseLines.push(`- ${number(stack.ms)} ms: ${stackDescription(stack, renderSource)}`);
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
    '## Priorisierte Beobachtungen\n', ...observations.slice(0, 8).map(f => `- **${f.type}:** [${f.caseId}](cases/${f.caseId}.md) – ${f.text}`),
    '\nDie Kategorien werden abwechselnd priorisiert. Vollständige Phase-Intervalle und Grenzintervalle sind getrennt; Hänger bleiben ungekürzt. Hauptthread-Bereiche sind verschachtelt, Worker parallel und GPU asynchron. Idle, GC-Überlappung oder Worker-Aktivität begründen allein keine Ursachenhypothese.\n',
    'Untersuchungsauftrag: Beobachtung und Ursache trennen; auffällige Aufrufketten im passenden Quellstand prüfen; eine begründete Änderung und den kleinsten aussagekräftigen Wiederholungstest vorschlagen. Nach der Änderung führt der Mensch den Test und perf:compare aus.\n',
    ...trace.notes.map(n => `- ${n}`), '\nOriginaldaten: [Spieltrace](fragdachse-trace.json), [Chrome-Trace](chrome-trace.json.gz), [aufbereitete Belege](evidence.json).'].join('\n'));
  await writeFile(join(directory, 'summary.json'), JSON.stringify({ ...summary, findings: observations }, null, 2));
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(trace));
}
