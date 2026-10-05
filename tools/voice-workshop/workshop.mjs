import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJson, voiceHash, validateVoiceBundle, VOICE_EVENTS } from '../../src/voice/VoicePackage.ts';
import { VoxGenerator } from './generator.mjs';
import { processAudio, checkAnnouncerSupport } from './audio.mjs';
import { ANNOUNCER, announcerDirection } from './announcer.mjs';
import { installGamePackage } from './game-packages.mjs';
import { planVoiceDeletion, eraseVoiceFiles } from './voice-deletion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCE_TEXT = Object.freeze(JSON.parse(await readFile(path.join(here, 'reference-text.json'), 'utf8')));
const ACTIVE = ['waiting', 'checking', 'generating', 'processing'];
const TESTS = [
  { id: 'test_neutral', event: 'ready', text: 'Na gut. Noch eine Runde.' },
  { id: 'test_dry', event: 'kill', text: 'Beschwerden bitte schriftlich.' },
  { id: 'test_energy', event: 'ultimate', text: 'Jetzt wird es unvernünftig.' },
].map(sentence => ({ ...sentence, directionHint: '', revision: 3, active: true }));
const requireValue = (value, message) => { if (!value) throw new Error(message); return value; };
const shortText = (value, max = 300) => requireValue(typeof value === 'string' && value.trim() && value.length <= max, 'Ungültiger Text.') && value.trim();

export class Workshop {
  constructor(root, generator = new VoxGenerator(), { gameVoiceRoot = null, deletionRegistry = null, gameBuildRoots = [] } = {}) {
    this.root = path.resolve(root); this.generator = generator; this.gameVoiceRoot = gameVoiceRoot;
    this.deletionRegistry = deletionRegistry; this.gameBuildRoots = gameBuildRoots;
    this.paused = true; this.saving = Promise.resolve();
  }
  async initialize() {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, 'media'), { recursive: true });
    await mkdir(path.join(this.root, 'packages'), { recursive: true });
    try { this.state = JSON.parse(await readFile(path.join(this.root, 'state.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Werkstatt-Daten sind beschädigt; bestehende Dateien werden nicht überschrieben.');
      this.state = { schema: 1, productionVersion: ANNOUNCER.productionVersion, voices: [], catalog: JSON.parse(await readFile(path.join(here, 'catalog.json'), 'utf8')), catalogVersion: 1, jobs: [], packages: [] };
    }
    // Migrate authoring fields only. Historical jobs and published packages retain their provenance.
    if (this.state.productionVersion !== ANNOUNCER.productionVersion) {
      for (const sentence of [...this.state.catalog, ...this.state.voices.flatMap(v => Object.values(v.sentences ?? {}))]) {
        if (sentence.style !== undefined || sentence.cloningMode !== undefined) {
          sentence.legacyDirection = { style: sentence.style ?? '', cloningMode: sentence.cloningMode ?? 'controllable' };
        }
        sentence.directionHint ??= '';
        delete sentence.style; delete sentence.cloningMode;
      }
      this.state.productionVersion = ANNOUNCER.productionVersion;
      this.state.catalogVersion++;
      for (const voice of this.state.voices) voice.testedRevision = 0;
    }
    for (const job of this.state.jobs) {
      job.cloningMode ??= 'controllable'; job.referenceTranscript ??= '';
      if (ACTIVE.includes(job.status)) { job.status = 'interrupted'; job.error = 'Dienst wurde beendet. Vor erneutem Start ComfyUI-Auftrag prüfen.'; }
    }
    await this.save();
  }
  save() {
    const text = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.catch(() => {}).then(async () => {
      const temp = path.join(this.root, 'state.pending');
      await writeFile(temp, text); await rename(temp, path.join(this.root, 'state.json'));
    });
    return this.saving;
  }
  voice(id) { return requireValue(this.state.voices.find(v => v.id === id), 'Stimme nicht gefunden.'); }
  job(id) { return requireValue(this.state.jobs.find(j => j.id === id), 'Take nicht gefunden.'); }
  file(name) { requireValue(/^[a-zA-Z0-9_.-]+$/.test(name), 'Ungültiger Medienpfad.'); return path.join(this.root, 'media', name); }
  catalog(voice) {
    return this.state.catalog.map(sentence => ({ ...sentence, ...voice.sentences?.[sentence.id],
      customized: !!voice.sentences?.[sentence.id] }));
  }
  stale(job) {
    const voice = this.voice(job.voiceId); const sentence = (job.test ? TESTS : this.catalog(voice)).find(s => s.id === job.sentenceId);
    return job.productionVersion !== ANNOUNCER.productionVersion || job.processingVersion !== ANNOUNCER.processingVersion
      || (job.status === 'review' && job.audioInfo?.processingVersion !== ANNOUNCER.processingVersion)
      || !sentence || voice.referenceRevision !== job.referenceRevision || sentence.revision !== job.sentenceRevision
      || (!job.test && (job.sentenceProfileRevision ?? 0) !== (voice.sentenceRevisions?.[job.sentenceId] ?? 0));
  }
  view() { return { ...this.state, announcer: { name: ANNOUNCER.name, productionVersion: ANNOUNCER.productionVersion }, voices: this.state.voices.map(v => ({ ...v, catalog: this.catalog(v) })),
    paused: this.paused, jobs: this.state.jobs.map(j => ({ ...j, stale: this.stale(j), needsAnnouncer: j.productionVersion !== ANNOUNCER.productionVersion || j.processingVersion !== ANNOUNCER.processingVersion })) }; }
  async action(action, data = {}) {
    requireValue(!this.deletingVoice, 'Eine Stimme wird gerade gelöscht. Bitte warten.');
    const affected = this.state.voices.find(v => v.id === (data.voiceId ?? (action === 'voice' ? data.id : this.state.jobs.find(j => j.id === data.id)?.voiceId)));
    requireValue(action === 'delete-voice' || !affected?.deletion, 'Die Löschung dieser Stimme ist noch nicht abgeschlossen. Bitte Löschung fortsetzen.');
    switch (action) {
      case 'delete-voice': return this.deleteVoice(data.voiceId, data.confirmName);
      case 'voice': {
        requireValue(typeof data.name === 'string' && data.name.trim() && data.name.length <= 80, 'Gib einen Anzeigenamen mit 1 bis 80 Zeichen ein und speichere das Profil erneut.');
        const name = shortText(data.name, 80);
        let voice = data.id ? this.voice(data.id) : null;
        if (!voice) { voice = { id: randomUUID(), referenceRevision: 0, testedRevision: 0 }; this.state.voices.push(voice); }
        Object.assign(voice, { name, language: 'de', consentGenerate: data.consentGenerate === true,
          consentLan: data.consentLan === true, consentPublic: data.consentPublic === true, archived: data.archived === true });
        break;
      }
      case 'reference': {
        const voice = this.voice(data.voiceId);
        requireValue(!this.state.jobs.some(j => j.voiceId === voice.id && ACTIVE.includes(j.status)), 'Zuerst laufende Produktion abschließen oder abbrechen.');
        requireValue(typeof data.audio === 'string' && data.audio.length < 40 * 1024 * 1024, 'Referenzdatei zu groß.');
        const source = data.source ?? 'script';
        requireValue(['script', 'upload'].includes(source), 'Unbekannte Referenzquelle.');
        if (source === 'script') requireValue(data.referenceTextId === REFERENCE_TEXT.id, 'Vorlesetext hat sich geändert. Werkstatt neu laden und den vorgegebenen Text aufnehmen.');
        else requireValue(typeof data.transcript === 'string' && data.transcript.trim() && data.transcript.length <= 5000,
          'Gib den gesprochenen Text der Referenzdatei ein (maximal 5000 Zeichen).');
        const transcript = source === 'script' ? REFERENCE_TEXT.text : data.transcript.trim();
        const revision = voice.referenceRevision + 1;
        const name = `${voice.id}-reference-${revision}-${randomUUID()}.wav`;
        const info = await processAudio(Buffer.from(data.audio, 'base64'), this.file(name), { reference: true, start: data.start ?? 0, end: data.end ?? null });
        Object.assign(voice, { reference: name, referenceRevision: revision, referenceInfo: info,
          referenceSource: source, referenceTextId: source === 'script' ? REFERENCE_TEXT.id : null, transcript, testedRevision: 0 });
        break;
      }
      case 'delete-reference': {
        const voice = this.voice(data.voiceId);
        requireValue(!this.state.jobs.some(j => j.voiceId === voice.id && ['checking', 'generating', 'processing'].includes(j.status)), 'Aktuellen eigenen Auftrag erst beenden lassen.');
        for (const j of this.state.jobs) if (j.voiceId === voice.id && j.status === 'waiting') j.status = 'cancelled';
        for (const job of this.state.jobs.filter(j => j.voiceId === voice.id && j.generator?.privateCopiesPending)) {
          await this.generator.cleanup(job); job.generator.privateCopiesPending = false;
        }
        const { readdir } = await import('node:fs/promises');
        for (const name of await readdir(path.join(this.root, 'media'))) if (name.startsWith(`${voice.id}-reference-`) && name.endsWith('.wav')) await unlink(this.file(name));
        voice.reference = null; voice.transcript = ''; voice.referenceTextId = null; voice.referenceSource = null; voice.referenceRevision++; voice.consentGenerate = false; voice.testedRevision = 0;
        break;
      }
      case 'sentence': {
        const voice = data.voiceId ? this.voice(data.voiceId) : null;
        const sentence = requireValue((voice ? this.catalog(voice) : this.state.catalog).find(s => s.id === data.id), 'Satz fehlt.');
        requireValue(data.cloningMode === undefined && data.style === undefined, 'Die Sprechregie wurde aktualisiert. Werkstatt neu laden.');
        const directionHint = data.directionHint ?? sentence.directionHint ?? '';
        requireValue(typeof directionHint === 'string' && directionHint.length <= 300, 'Regiehinweis darf höchstens 300 Zeichen enthalten.');
        const fields = { text: shortText(data.text), directionHint: directionHint.trim(), active: data.active === true };
        if (Object.entries(fields).every(([key, value]) => sentence[key] === value)) break;
        if (voice) {
          voice.sentenceRevisions ??= {}; voice.sentences ??= {};
          voice.sentenceRevisions[sentence.id] = (voice.sentenceRevisions[sentence.id] ?? 0) + 1;
          voice.sentences[sentence.id] = { ...voice.sentences[sentence.id], ...fields, revision: voice.sentenceRevisions[sentence.id] };
        } else {
          Object.assign(sentence, fields, { revision: sentence.revision + 1 });
          this.state.catalogVersion++;
        }
        break;
      }
      case 'sentence-reset': {
        const voice = this.voice(data.voiceId);
        requireValue(this.state.catalog.some(s => s.id === data.id), 'Satz fehlt.');
        if (voice.sentences?.[data.id]) {
          delete voice.sentences[data.id];
          // Keep the profile epoch even while inheriting: resetting must not revive old audio.
          voice.sentenceRevisions[data.id]++;
        }
        break;
      }
      case 'generate': {
        const voice = this.voice(data.voiceId);
        requireValue(voice.reference && voice.consentGenerate && !voice.archived, 'Referenz und Zustimmung zur Generierung erforderlich.');
        if (data.lan === true) requireValue(voice.consentLan, 'Aktiviere im Profil die Zustimmung für Generierung und LAN-Nutzung.');
        let sentences;
        if (data.testId) sentences = [requireValue(TESTS.find(s => s.id === data.testId), 'Stimmtest nicht gefunden.')];
        else if (data.tests === true) sentences = TESTS.filter(s => !this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j)
          && (ACTIVE.includes(j.status) || (j.status === 'review' && j.decision !== 'rejected'))));
        else if (data.sentenceId) sentences = [requireValue(this.catalog(voice).find(s => s.id === data.sentenceId), 'Satz fehlt.')];
        else {
          requireValue(data.lan === true || voice.testedRevision === voice.referenceRevision, 'Zuerst drei Stimmtests anhören und bestätigen.');
          sentences = this.catalog(voice).filter(s => s.active && !this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j) && ((j.status === 'review' && (data.lan === true || j.decision !== 'rejected')) || ACTIVE.includes(j.status))));
        }
        sentences = sentences.filter(s => !this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j) && ACTIVE.includes(j.status)));
        requireValue(this.state.jobs.filter(j => ACTIVE.includes(j.status)).length + sentences.length <= 80, 'Warteschlange voll.');
        if (data.start === true) { await checkAnnouncerSupport(); await this.generator.preflight(); }
        for (const sentence of sentences) this.state.jobs.push({ id: randomUUID(), voiceId: voice.id, sentenceId: sentence.id, sentenceRevision: sentence.revision,
          sentenceProfileRevision: voice.sentenceRevisions?.[sentence.id] ?? 0,
          referenceRevision: voice.referenceRevision, reference: voice.reference, text: sentence.text, directionHint: sentence.directionHint ?? '', event: sentence.event,
          controlInstruction: announcerDirection(sentence.event, sentence.directionHint ?? ''),
          productionVersion: ANNOUNCER.productionVersion, processingVersion: ANNOUNCER.processingVersion,
          cloningMode: 'controllable', referenceTranscript: '',
          seed: randomInt(0, 2147483647), status: 'waiting', decision: null, test: data.tests === true || !!data.testId, createdAt: Date.now() });
        if (data.start === true) this.paused = false;
        break;
      }
      case 'tested': {
        const voice = this.voice(data.voiceId);
        requireValue(TESTS.every(s => this.state.jobs.some(j => j.voiceId === voice.id && j.sentenceId === s.id && !this.stale(j) && j.decision === 'accepted')), 'Alle drei aktuellen Stimmtests müssen angehört und angenommen sein.');
        voice.testedRevision = voice.referenceRevision; break;
      }
      case 'review': {
        const job = this.job(data.id);
        requireValue(job.status === 'review' && !this.stale(job), 'Nur aktuelle prüfbereite Takes freigeben.');
        requireValue(['accepted', 'rejected'].includes(data.decision), 'Prüfentscheidung fehlt.');
        if (data.decision === 'accepted') requireValue(data.listened === true, 'Exportfassung zuerst vollständig anhören.');
        job.decision = data.decision; break;
      }
      case 'lan-selection': {
        const job = this.job(data.id);
        requireValue(job.status === 'review' && !this.stale(job), 'Nur aktuelle fertige Sprüche auswählen.');
        requireValue(typeof data.include === 'boolean', 'Auswahl fehlt.');
        // Inclusion is a package selection, not a claim that someone listened.
        job.decision = data.include ? null : 'rejected'; break;
      }
      case 'trim': {
        const job = this.job(data.id); requireValue(job.raw && ['review', 'failed'].includes(job.status), 'Keine abgeschlossene Rohfassung vorhanden.');
        requireValue(!this.stale(job), 'Veraltete Aufnahme. Für den Action-Announcer bitte neu erzeugen.');
        const audio = `${job.id}-${randomUUID()}.ogg`;
        const info = await processAudio(await readFile(this.file(job.raw)), this.file(audio), { start: data.start, end: data.end });
        job.audio = audio; job.audioInfo = info; job.decision = null; job.status = 'review'; job.error = null; break;
      }
      case 'cancel':
        for (const job of this.state.jobs) if ((!data.id || data.id === job.id) && ACTIVE.includes(job.status)) { job.cancelled = true; if (job.status === 'waiting') job.status = 'cancelled'; }
        this.paused = true; break;
      case 'cleanup':
        for (const job of this.state.jobs.filter(j => j.generator?.privateCopiesPending && !ACTIVE.includes(j.status))) {
          await this.generator.cleanup(job); job.generator.privateCopiesPending = false;
        }
        break;
      case 'pause': this.paused = true; break;
      case 'resume': this.paused = false; break;
      case 'release': return this.release(data.voiceId, data.partial === true);
      case 'lan-release': return this.release(data.voiceId, true, true);
      case 'install-game': {
        requireValue(this.gameVoiceRoot, 'Der Projektordner für Spielstimmen ist in diesem Werkstatt-Dienst nicht eingerichtet.');
        await this.release(data.voiceId, true, true);
        const entry = this.state.packages.filter(p => p.voiceId === data.voiceId).at(-1);
        const bundle = await this.bundle([entry.checksum]);
        this.voice(data.voiceId).gamePackage = await installGamePackage(this.gameVoiceRoot, bundle);
        break;
      }
      case 'remove-package': {
        const entry = requireValue(this.state.packages.find(p => p.checksum === data.checksum), 'Paket fehlt.');
        await unlink(path.join(this.root, 'packages', `${entry.checksum}.fdvoice`));
        this.state.packages = this.state.packages.filter(p => p !== entry); break;
      }
      default: throw new Error('Unbekannte Aktion.');
    }
    await this.save(); void this.pump(); return this.view();
  }
  async deleteVoice(voiceId, confirmName) {
    const voice = this.voice(voiceId);
    requireValue(confirmName === voice.name, 'Zum endgültigen Löschen den Namen der Stimme bestätigen.');
    requireValue(!this.state.jobs.some(j => ['checking', 'generating', 'processing'].includes(j.status)), 'Laufende Produktion zuerst pausieren und den aktuellen Take beenden lassen.');
    this.paused = true; this.deletingVoice = voiceId;
    try {
      await this.saving;
      const plan = await planVoiceDeletion(this, voiceId);
      voice.deletion = { error: null };
      for (const job of this.state.jobs.filter(j => j.voiceId === voiceId && j.status === 'waiting')) { job.status = 'cancelled'; job.cancelled = true; }
      await this.save();
      const next = await eraseVoiceFiles(this, plan);
      const previous = this.state; this.state = next;
      try { await this.save(); } catch (error) { this.state = previous; throw error; }
      return this.view();
    } catch (error) {
      voice.deletion = { error: error.message };
      await this.save();
      throw new Error(`Löschung noch nicht vollständig: ${error.message} Danach „Löschung fortsetzen“ wählen.`);
    } finally { this.deletingVoice = null; }
  }
  async pump() {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      while (!this.paused) {
        const job = this.state.jobs.find(j => j.status === 'waiting' && !this.voice(j.voiceId).deletion); if (!job) break;
        try {
          const voice = this.voice(job.voiceId);
          requireValue(!this.stale(job) && voice.consentGenerate && !voice.archived, 'Stimme gesperrt oder Auftrag überholt.');
          job.status = 'checking'; await this.save();
          await checkAnnouncerSupport();
          const bytes = await this.generator.generate(job, this.file(job.reference), async metadata => { job.generator = metadata; job.status = metadata.promptId === null ? 'checking' : 'generating'; await this.save(); }, () => job.cancelled);
          if (job.cancelled) throw new Error('Abgebrochen.');
          job.raw = `${job.id}.flac`; await writeFile(this.file(job.raw), bytes, { flag: 'wx' });
          job.status = 'processing'; await this.save();
          const audio = `${job.id}.ogg`; const info = await processAudio(bytes, this.file(audio));
          job.audio = audio; job.audioInfo = info;
          job.status = job.cancelled ? 'cancelled' : 'review';
        } catch (error) { job.status = job.cancelled ? 'cancelled' : 'failed'; job.error = error.message; this.paused = true; }
        await this.save();
      }
    } catch (error) {
      this.paused = true; console.error('Voice-Werkstatt: Produktion wegen eines Speicherfehlers angehalten.', error.message);
    } finally { this.running = false; }
  }
  releaseSummary(voiceId, lan = false) {
    const voice = this.voice(voiceId); const chosen = new Map();
    for (const job of this.state.jobs) if (job.voiceId === voice.id && !job.test && !this.stale(job) && job.status === 'review' && job.audio && (lan || job.decision === 'accepted')
      && this.catalog(voice).some(s => s.id === job.sentenceId && s.active)) chosen.set(job.sentenceId, job);
    const jobs = [...chosen.values()].filter(j => !lan || j.decision !== 'rejected');
    return { jobs, missingEvents: VOICE_EVENTS.filter(event => !jobs.some(j => j.event === event)),
      bytes: jobs.reduce((n, j) => n + j.audioInfo.bytes, 0), seconds: jobs.reduce((n, j) => n + j.audioInfo.duration, 0) };
  }
  async release(voiceId, partial, lan = false) {
    const voice = this.voice(voiceId); requireValue(voice.consentLan && !voice.archived && !voice.deletion, 'Freigabe für den Teilnehmerkreis fehlt oder Stimme wird gelöscht.');
    const summary = this.releaseSummary(voiceId, lan);
    if (lan) requireValue(summary.jobs.length, 'Noch keine fertigen Spielsprüche vorhanden. Starte zuerst die Produktion.');
    requireValue(summary.jobs.length && (!summary.missingEvents.length || partial), `Teilpaket ausdrücklich bestätigen. Fehlend: ${summary.missingEvents.join(', ')}`);
    const version = 1 + Math.max(0, ...this.state.packages.filter(p => p.voiceId === voiceId).map(p => p.version), voice.lastVersion ?? 0);
    const files = {}; const clips = [];
    for (const job of summary.jobs) {
      const bytes = await readFile(this.file(job.audio)); const file = `${job.id}.ogg`;
      files[file] = bytes.toString('base64');
      clips.push({ id: job.id, sentenceId: job.sentenceId, event: job.event, file, sha256: await voiceHash(bytes), bytes: bytes.length, duration: job.audioInfo.duration, codec: 'vorbis' });
    }
    const manifest = { schema: 1, catalogVersion: this.state.catalogVersion, packageId: voice.id, version, voiceId: voice.id, name: voice.name, language: 'de', missingEvents: summary.missingEvents, clips };
    const checksum = await voiceHash(canonicalJson(manifest));
    const bundle = await validateVoiceBundle({ format: 'fragdachse-voice', schema: 1, packages: [{ manifest, checksum, files }] });
    await writeFile(path.join(this.root, 'packages', `${checksum}.fdvoice`), JSON.stringify(bundle), { flag: 'wx' });
    voice.lastVersion = version;
    this.state.packages.push({ checksum, voiceId, name: voice.name, version, clips: clips.length, bytes: summary.bytes, missingEvents: summary.missingEvents });
    await this.save(); return this.view();
  }
  async bundle(checksums) {
    requireValue(Array.isArray(checksums) && checksums.length > 0 && checksums.length <= 10, 'Ein bis zehn Pakete auswählen.');
    const packages = [];
    for (const checksum of [...new Set(checksums)]) {
      requireValue(this.state.packages.some(p => p.checksum === checksum && !this.voice(p.voiceId).archived && !this.voice(p.voiceId).deletion && this.voice(p.voiceId).consentLan), 'Paket ist nicht zur Weitergabe freigegeben.');
      packages.push(...JSON.parse(await readFile(path.join(this.root, 'packages', `${checksum}.fdvoice`), 'utf8')).packages);
    }
    return validateVoiceBundle({ format: 'fragdachse-voice', schema: 1, packages });
  }
}
