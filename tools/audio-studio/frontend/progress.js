export function jobProgress(run) {
  const total = Math.max(1, run.seeds?.length || run.total || 1), completed = run.completed || 0;
  const progress = run.progress || {}, sampling = progress.stage === 'sampling';
  const fraction = sampling ? Math.min(1, Math.max(0, progress.fraction || 0)) : 0;
  const finished = {complete: 'Generierung abgeschlossen', cancelled: 'Auftrag abgebrochen', failed: 'Generierung fehlgeschlagen', interrupted: 'Auftrag unterbrochen'};
  if (finished[run.status]) return {label: finished[run.status], kind: ['failed', 'interrupted'].includes(run.status) ? 'error' : 'success', percent: run.status === 'complete' ? 100 : completed / total * 100, detail: ''};
  if (run.status === 'cancelling') return {label: 'Abbruch angefordert', kind: 'busy', percent: Math.min(99, (completed + fraction) / total * 100), detail: 'Der aktuelle Modellaufruf kann noch fertig werden. Fertige RAWs bleiben erhalten.'};
  if (run.status === 'queued' || progress.stage === 'queued') return {label: 'In der Warteschlange', kind: 'busy', percent: null, detail: progress.detail || 'Der Auftrag startet, sobald das Modell frei ist.'};
  if (run.status === 'loading' || progress.stage === 'loading') return {label: 'Modell wird vorbereitet', kind: 'busy', percent: null, detail: progress.detail || 'Lokale Modelldateien werden vorbereitet. Noch keine verlässliche Prozentangabe.'};
  return {
    label: `Kandidat ${Math.min(total, completed + 1)} von ${total} · ${progress.stage === 'finalizing' ? 'RAW wird gespeichert und geprüft' : 'Sound wird generiert'}`,
    kind: 'busy', percent: progress.indeterminate ? null : sampling || progress.stage === 'finalizing' ? Math.min(99, (completed + (progress.stage === 'finalizing' ? 1 : fraction)) / total * 100) : completed ? completed / total * 100 : null,
    detail: progress.detail || (sampling ? `Modellschritt ${progress.completed_steps || 0} / ${progress.total_steps || '–'}` : 'Abgeschlossen ist der Kandidat nach der WAV-Prüfung.'),
  };
}
