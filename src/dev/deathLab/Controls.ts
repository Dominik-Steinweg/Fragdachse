import type { DeathLabApi } from './api';
import { FIXTURES, LAYERS, fixtureFrames } from './State';

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const tuningFields = [
  ['durationMs', 'Dauer ms', 1], ['morphDesyncMaxScale', 'Morph-Streuung', 0.01],
  ['frayedAt', 'Frayed', 0.01], ['porousAt', 'Porous', 0.01],
  ['fragmentedAt', 'Fragmented', 0.01], ['dustAt', 'Dust', 0.01],
  ['fineDustAt', 'Fine dust', 0.01], ['hazeAt', 'Haze', 0.01],
  ['vaporAt', 'Vapor', 0.01], ['alpha', 'Alpha', 0.01],
  ['mainFragmentScaleBoost', 'Fragmentgröße ×', 0.05], ['mainHitImpulse', 'Richtungsimpuls ×', 0.05],
] as const;
export function attachControls(api: DeathLabApi): () => void {
  const disposers: (() => void)[] = [];
  const bind = (id: string, type: string, action: () => void) => {
    const el = document.getElementById(id)!; el.addEventListener(type, action);
    disposers.push(() => el.removeEventListener(type, action));
  };
  const run = (command: unknown) => { void api.run(command).catch(error => {
    document.getElementById('status')!.textContent = String(error);
  }); };
  const fixtures = document.getElementById('fixture')!;
  for (const fixture of FIXTURES) {
    const option = document.createElement('option'); option.value = fixture.id; option.textContent = fixture.label; fixtures.append(option);
  }
  const layerLabels = ['Hauptmasse', 'Micro-Motes', 'Glows', 'Spieler-Geist', 'Gore-Spray', 'Death-PostFX'];
  LAYERS.forEach((key, i) => {
    const label = document.createElement('label'), check = document.createElement('input');
    check.id = `layer-${key}`; check.type = 'checkbox'; label.append(check, layerLabels[i]);
    document.getElementById('layers')!.append(label);
    bind(check.id, 'change', () => run({ action: 'configure', values: { layers: { [key]: check.checked } } }));
  });
  for (const [key, caption, step] of tuningFields) {
    const label = document.createElement('label'), field = document.createElement('input');
    field.id = `tuning-${key}`; field.type = 'number'; field.step = String(step); field.min = '0';
    label.append(caption, field); document.getElementById('tuning-fields')!.append(label);
  }
  bind('fixture', 'change', () => {
    const fixture = FIXTURES.find(f => f.id === input('fixture').value)!;
    input('size').value = String(fixture.size); input('frameIndex').value = '0';
  });
  bind('pose', 'change', () => { input('frameIndex').value = '0'; });
  bind('apply-fixture', 'click', () => run({ action: 'configure', values: {
    fixture: input('fixture').value, pose: input('pose').value, quality: input('quality').value,
    background: input('background').value,
    ...Object.fromEntries(['frameIndex', 'seed', 'direction', 'rotation', 'size', 'zoom'].map(k => [k, Number(input(k).value)])),
  } }));
  bind('apply-tuning', 'click', () => run({ action: 'tuning', values: Object.fromEntries(tuningFields.map(([key]) => [key, Number(input(`tuning-${key}`).value)])) }));
  bind('apply-json', 'click', () => {
    try { run({ action: 'tuning', values: JSON.parse(input('tuning-json').value) }); }
    catch (error) { document.getElementById('status')!.textContent = String(error); }
  });
  bind('reset-tuning', 'click', () => run({ action: 'tuning', reset: true }));
  bind('play', 'click', () => run({ action: 'play', playing: !api.status().playing, speed: Number(input('speed').value) }));
  bind('speed', 'change', () => run({ action: 'play', playing: api.status().playing, speed: Number(input('speed').value) }));
  bind('back', 'click', () => run({ action: 'step', deltaMs: -25 }));
  bind('forward', 'click', () => run({ action: 'step', deltaMs: 25 }));
  bind('restart', 'click', () => run({ action: 'seek', timeMs: 0 }));
  bind('scrub', 'input', () => run({ action: 'seek', timeMs: Number(input('scrub').value) }));
  bind('freeze', 'click', () => run({ action: 'freeze' }));
  bind('clear-a', 'click', () => run({ action: 'clearBaseline' }));
  bind('export', 'click', () => run({ action: 'export', frames: 60, stepMs: 25, download: true }));
  let settingsKey = '', tuningKey = '';
  disposers.push(api.subscribe(() => {
    const state = api.status();
    for (const id of ['fixture-controls', 'layer-controls', 'tuning-controls']) (document.getElementById(id) as HTMLFieldSetElement).disabled = state.busy || !state.ready;
    for (const id of ['play', 'back', 'forward', 'restart', 'speed', 'scrub', 'freeze', 'clear-a', 'export']) input(id).disabled = state.busy || !state.ready;
    const sk = JSON.stringify(state.settings), tk = JSON.stringify(state.tuning);
    if (sk !== settingsKey) {
      settingsKey = sk;
      for (const [key, value] of Object.entries(state.settings)) if (key !== 'layers') input(key).value = String(value);
      input('frameIndex').max = String(fixtureFrames(state.settings).length - 1);
      for (const key of LAYERS) input(`layer-${key}`).checked = state.settings.layers[key];
    }
    if (tk !== tuningKey) {
      tuningKey = tk;
      for (const [key] of tuningFields) input(`tuning-${key}`).value = String(state.tuning[key]);
      input('tuning-json').value = JSON.stringify(state.tuning, null, 2);
      const bands = document.getElementById('bands')!; bands.replaceChildren();
      for (const band of state.phaseBands) {
        const row = document.createElement('div'); row.className = `band ${band.name === 'dustAt' ? 'critical' : ''}`;
        const label = document.createElement('span'); label.textContent = band.name.replace('At', '');
        const track = document.createElement('div'); track.className = 'track';
        track.title = `${band.earliestMs.toFixed(1)}–${band.latestMs.toFixed(1)} ms`;
        const range = document.createElement('span'); range.className = 'range';
        range.style.left = `${band.earliestMs / 15}%`; range.style.width = `${Math.max(0.2, (band.latestMs - band.earliestMs) / 15)}%`;
        const tick = document.createElement('span'); tick.className = 'tick'; tick.style.left = `${band.nominalMs / 15}%`;
        track.append(range, tick); row.append(label, track); bands.append(row);
      }
    }
    document.getElementById('bands')!.style.setProperty('--cursor', `${state.timeMs / 15}%`);
    input('scrub').value = String(state.timeMs); input('speed').value = String(state.speed);
    document.getElementById('clock')!.textContent = `${state.timeMs.toFixed(1)} ms`;
    document.getElementById('play')!.textContent = state.playing ? 'Pause' : 'Abspielen';
    document.getElementById('reference-empty')!.style.display = state.baseline ? 'none' : 'grid';
    document.getElementById('a-time')!.textContent = state.baseline ? `${state.timeMs.toFixed(1)} ms` : '—';
    api.drawBaseline(document.getElementById('reference') as HTMLCanvasElement);
    const status = document.getElementById('status')!; status.classList.toggle('error', !!state.error);
    status.textContent = state.error ?? (state.busy ? 'Aufnahme / Verarbeitung läuft …' : !state.ready ? 'Code- und Asset-Identität werden vorbereitet …'
      : `${state.baseline ? 'A/B synchron · ' : ''}Seed ${state.settings.seed} · ${state.settings.quality} · Frame ${fixtureSnapshotFrame(state.settings)}\n${state.baseline ? `Referenzraster: angefragt ${state.requestedTimeMs.toFixed(1)} → gezeigt ${state.timeMs.toFixed(1)} ms.` : 'Bereit. Vor Änderungen an B eine Referenz A aufnehmen.'}`);
  }));
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
function fixtureSnapshotFrame(settings: import('./State').LabSettings): number { return fixtureFrames(settings)[settings.frameIndex]; }
