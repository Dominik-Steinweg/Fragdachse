import { readFile, unlink, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const WORKFLOW_VERSION = 'rh-voxcpm2-dual-cloning-v2';
export function isOwnAudioOutput(output, folder) {
  return output?.type === 'output' && typeof output.subfolder === 'string'
    && output.subfolder.replaceAll('\\', '/') === folder && /^take_[a-zA-Z0-9_.-]+\.flac$/.test(output.filename);
}
export function makeWorkflow(reference, text, style, seed, prefix, { mode = 'controllable', transcript = '' } = {}) {
  if (!['ultimate', 'controllable'].includes(mode)) throw new Error('Unbekannter Cloning-Modus.');
  const ultimate = mode === 'ultimate';
  if (ultimate && !transcript.trim()) throw new Error('Ultimate Cloning benötigt das exakte Transkript der Referenzaufnahme.');
  return {
    '1': { class_type: 'RunningHub_VoxCPM_LoadModel', inputs: { model_name: 'VoxCPM2', optimize: false, lora_name: 'None' } },
    '2': { class_type: 'LoadAudio', inputs: { audio: reference } },
    '3': { class_type: 'RunningHub_VoxCPM_Generate', inputs: { model: ['1', 0], reference_audio: ['2', 0],
      text, control_instruction: ultimate ? '' : style, ultimate_clone: ultimate, reference_audio_text: ultimate ? transcript : '', normalize_text: false,
      denoise_reference: false, cfg_value: 2, inference_steps: 10, seed, max_len: 1024, retry_badcase: true } },
    '4': { class_type: 'SaveAudio', inputs: { audio: ['3', 0], filename_prefix: prefix } },
  };
}
export class VoxGenerator {
  constructor(options = {}) {
    this.url = options.url ?? process.env.VOICE_COMFY_URL ?? 'http://127.0.0.1:8188';
    const url = new URL(this.url);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('ComfyUI muss lokal erreichbar sein.');
    this.inputRoot = options.inputRoot ?? process.env.VOICE_COMFY_INPUT;
    this.outputRoot = options.outputRoot ?? process.env.VOICE_COMFY_OUTPUT;
  }
  async request(route, init) {
    let response;
    try { response = await fetch(`${this.url}${route}`, { ...init, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('ComfyUI nicht erreichbar. Lokalen Generator starten und erneut versuchen.'); }
    if (!response.ok) throw new Error(`ComfyUI ${route}: HTTP ${response.status}`);
    return response;
  }
  async preflight() {
    const nodes = await (await this.request('/object_info')).json();
    const workflow = makeWorkflow('reference.wav', 'Test.', 'Neutral', 1, 'voice-workshop/test');
    for (const node of Object.values(workflow)) {
      const spec = nodes[node.class_type];
      if (!spec) throw new Error(`ComfyUI-Node fehlt: ${node.class_type}`);
      for (const key of Object.keys(node.inputs)) {
        if (!(key in (spec.input?.required ?? {})) && !(key in (spec.input?.optional ?? {}))) throw new Error(`Inkompatibler Node: ${node.class_type}.${key}`);
      }
    }
    const models = nodes.RunningHub_VoxCPM_LoadModel.input.required.model_name[0];
    if (!models.includes('VoxCPM2')) throw new Error('VoxCPM2 ist nicht lokal installiert.');
    const queue = await (await this.request('/queue')).json();
    if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error('Generator belegt. Fremde Aufträge werden nicht verändert.');
    if (!this.inputRoot || !this.outputRoot) throw new Error('VOICE_COMFY_INPUT und VOICE_COMFY_OUTPUT für die Bereinigung privater Kopien konfigurieren.');
    return { workflow: WORKFLOW_VERSION, nodeSchemaHash: createHash('sha256').update(JSON.stringify(Object.keys(workflow).map(key => nodes[workflow[key].class_type]))).digest('hex') };
  }
  async generate(job, referencePath, onSubmitted, cancelled) {
    const folder = `voice-workshop/${job.id}`;
    const workflow = makeWorkflow(`${folder}/reference.wav`, job.text, job.style, job.seed, `${folder}/take`,
      { mode: job.cloningMode ?? 'controllable', transcript: job.referenceTranscript ?? '' });
    const metadata = await this.preflight();
    // Journal ownership before the first private copy, including uncertain submit outcomes.
    await onSubmitted({ ...metadata, promptId: null, privateCopiesPending: true });
    const form = new FormData();
    form.append('image', new Blob([await readFile(referencePath)], { type: 'audio/wav' }), 'reference.wav');
    form.append('subfolder', folder); form.append('type', 'input'); form.append('overwrite', 'false');
    const upload = await (await this.request('/upload/image', { method: 'POST', body: form })).json();
    if (upload.name !== 'reference.wav' || upload.subfolder !== folder || upload.type !== 'input') throw new Error('Unerwarteter ComfyUI-Uploadpfad.');
    let output; let promptId; let completed = false;
    try {
      const submitted = await (await this.request('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: `voice-workshop-${job.id}` }) })).json();
      if (!submitted.prompt_id || submitted.error) throw new Error('ComfyUI hat den Voice-Auftrag abgelehnt.');
      promptId = submitted.prompt_id;
      await onSubmitted({ ...metadata, promptId, workflow, privateCopiesPending: true });
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const history = await (await this.request(`/history/${encodeURIComponent(promptId)}`)).json();
        const result = history[promptId];
        if (result?.status?.status_str === 'error') { completed = true; throw new Error('VoxCPM2-Generierung fehlgeschlagen; Auftrags-ID in ComfyUI prüfen.'); }
        if (result?.status?.completed) {
          completed = true;
          output = result.outputs?.['4']?.audio?.[0];
          if (!isOwnAudioOutput(output, folder)) throw new Error('Die Generatorausgabe passt nicht zum Auftrag. Starte den Take erneut; bei Wiederholung die ComfyUI-Version prüfen.');
          if (cancelled()) throw new Error('Auftrag abgebrochen.');
          const response = await this.request(`/view?${new URLSearchParams(output)}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 32 * 1024 * 1024) throw new Error('Generatorausgabe zu groß.');
          return bytes;
        }
        // Never issue global interrupt/free: a shared GPU can also belong to Audio-Studio.
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Zeitlimit. ComfyUI-Auftrag vor erneutem Start prüfen; private Kopien bleiben zur gezielten Bereinigung vorgemerkt.');
    } finally {
      if (completed) {
        try {
          await this.cleanup(job);
          if (job.generator) job.generator.privateCopiesPending = false;
        } catch { /* The ownership journal enables cleanup after restart. */ }
      }
    }
  }

  async cleanup(job) {
    if (!/^[a-f0-9-]{36}$/.test(job.id) || !this.inputRoot || !this.outputRoot) throw new Error('Bereinigung benötigt konfigurierte ComfyUI-Verzeichnisse.');
    const queue = await (await this.request('/queue')).json();
    const folder = `voice-workshop/${job.id}`;
    if ([...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some(entry => entry[1] === job.generator?.promptId || JSON.stringify(entry[2]).includes(folder))) {
      throw new Error('Dieser eigene ComfyUI-Auftrag läuft noch. Nach seinem Ende erneut bereinigen.');
    }
    for (const root of [this.inputRoot, this.outputRoot]) {
      const base = await realpath(root); const dir = path.resolve(base, 'voice-workshop', job.id);
      let resolved;
      try { resolved = await realpath(dir); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (resolved !== dir || !resolved.startsWith(base + path.sep)) throw new Error('Unsicherer Bereinigungspfad.');
      for (const file of await readdir(dir, { withFileTypes: true })) {
        if (file.isFile() && (file.name === 'reference.wav' || /^take_[a-zA-Z0-9_.-]+\.flac$/.test(file.name))) await unlink(path.join(dir, file.name));
      }
    }
  }
}
