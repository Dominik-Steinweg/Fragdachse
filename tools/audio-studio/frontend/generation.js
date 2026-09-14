export function generationLabel(run, candidate, models = []) {
  if (run.status === 'imported' || candidate?.generation?.kind === 'game_import') return 'Game-Import';
  const id = run.author_snapshot?.generation_defaults?.model || 'Unbekanntes Modell';
  const model = models.find(model => model.name === id);
  const metadata = candidate?.generation;
  // Old native runs predate the router. Preserve their actual Python origin
  // even when the current registry routes that model through ComfyUI.
  const backend = metadata?.backend || (metadata?.model_id?.startsWith('stabilityai/') ? 'python' : model?.backend);
  const name = model?.label || id;
  return backend ? `${name} (${{python: 'Python', comfyui: 'ComfyUI'}[backend] || backend})` : name;
}

export function generationSettings(run, candidate) {
  const settings = run.author_snapshot?.generation_defaults;
  if (run.status === 'imported' || !settings) return 'Game-Import';
  return `Seed ${candidate?.seed ?? '–'} · ${settings.duration_seconds} s · ${settings.steps} Schritte · CFG ${settings.cfg_scale}`;
}
