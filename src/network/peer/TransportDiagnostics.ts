/**
 * Transportdiagnose auf Basis der WebRTC-Statistiken.
 *
 * Zweck ist Messen und Sichtbarmachen, nicht Regeln: der einzige harte Eingriff ist die
 * Ablehnung von Relay-Verbindungen. Da bewusst kein TURN konfiguriert ist, darf ein
 * Relay-Kandidat gar nicht auftreten – tritt er doch auf, ist die ICE-Konfiguration kaputt
 * und die Verbindung wird abgewiesen statt still über einen fremden Server zu laufen.
 *
 * Grenzwerte für Ping und Jitter werden hier absichtlich NICHT festgelegt. Zuerst sollen
 * reale Werte mit den üblichen Mitspielern gesammelt werden.
 */
import {
  PEER_DIAGNOSTICS_BACKPRESSURE_BYTES,
  PEER_DIAGNOSTICS_BACKPRESSURE_LOG_INTERVAL_MS,
  PEER_DIAGNOSTICS_BACKPRESSURE_STALL_MS,
  PEER_DIAGNOSTICS_POLL_MS,
  PEER_DIAGNOSTICS_SAMPLE_WINDOW,
} from '../../config';
import type { PeerChannelKind, PeerMessage } from './protocol';

export type IceCandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

/** Eine vollständig an den Kanal übergebene Nachricht – Kontext für Rückstau-Meldungen. */
export interface RecentSendSample {
  atMs: number;
  channel: PeerChannelKind;
  message: PeerMessage;
  wireBytes: number;
}

/** Kurzform für das Log: Batches mit ihren Keys, RPCs mit ihrem Namen. */
export function describePeerMessage(message: PeerMessage): string {
  if (message.t === 'rpc') return `rpc:${message.n}`;
  if (message.t !== 'b') return message.t;
  const keys = new Set<string>();
  for (const [key] of message.g ?? []) keys.add(key);
  for (const [, key] of message.p ?? []) keys.add(key);
  return `b[${[...keys].join(',')}]`;
}

export function formatRecentSends(samples: readonly RecentSendSample[], nowMs: number): string {
  if (samples.length === 0) return 'keine';
  return samples
    .map((sample) => `${sample.channel}:${describePeerMessage(sample.message)} ${sample.wireBytes} B vor ${nowMs - sample.atMs} ms`)
    .join(' | ');
}

export interface LinkDiagnostics {
  /** Spiel-seitige Spieler-ID der Gegenseite; leer, solange der Handshake läuft. */
  playerId: string;
  peerId: string;
  connectionState: RTCPeerConnectionState | 'unknown';
  iceConnectionState: RTCIceConnectionState | 'unknown';
  reliableChannelState: RTCDataChannelState | 'missing';
  fastChannelState: RTCDataChannelState | 'missing';
  localCandidateType: IceCandidateType | null;
  remoteCandidateType: IceCandidateType | null;
  /** True, wenn eine Seite über einen Relay läuft – gilt als Konfigurationsfehler. */
  usesRelay: boolean;
  /**
   * Netzwerk-RTT des ausgewählten Kandidatenpaars – die Zahl, die in Shootern als „Ping"
   * angezeigt wird. Wird vom ICE-Stack des Browsers per STUN gemessen, also außerhalb
   * unseres Main-Threads und damit unabhängig von der Bildrate.
   */
  rttMs: number | null;
  medianRttMs: number | null;
  maxRttMs: number | null;
  jitterRttMs: number | null;
  rttSampleCount: number;
  /**
   * Anwendungs-Ping: derselbe Weg, aber durch beide Spielschleifen. Enthält die
   * Frame-Quantisierung und bildet damit die gefühlte Reaktionszeit ab, nicht die Leitung.
   */
  medianAppPingMs: number | null;
  maxAppPingMs: number | null;
  jitterAppPingMs: number | null;
  appPingSampleCount: number;
  connectDurationMs: number | null;
  disconnectCount: number;
  bytesSent: number;
  bytesReceived: number;
  reliableBufferedBytes: number;
  fastBufferedBytes: number;
  /** True, wenn ein Sendepuffer über die Beobachtungsschwelle gewachsen ist. */
  backpressure: boolean;
  droppedFastMessages: number;
}

/** Was die Diagnose von einer Verbindung braucht. Hält den Test frei von WebRTC. */
export interface DiagnosableLink {
  readonly remotePeerId: string;
  readonly playerId: string;
  readonly createdAtMs: number;
  readonly openedAtMs: number;
  readonly peerConnection: RTCPeerConnection | undefined;
  readonly reliableChannel: RTCDataChannel | undefined;
  readonly unreliableChannel: RTCDataChannel | null;
  readonly droppedFastCount: number;
  /** Kontext für Rückstau-Meldungen; fehlt bei Test-Links ohne Sendepfad. */
  readonly recentSends?: readonly RecentSendSample[];
  readonly reliableQueuedBytes?: number;
  readonly fastQueuedBytes?: number;
  /** Wird nur bei abgelehnten Relay-Verbindungen benutzt. */
  close(): void;
}

export interface TransportDiagnosticsDeps {
  getLinks: () => DiagnosableLink[];
  /** Anwendungs-Ping in ms zum angegebenen Spieler; 0 oder negativ = noch keine Messung. */
  getAppPingMs: (playerId: string) => number;
  /** Wird einmal je Verbindung gemeldet, sobald ein Relay-Kandidat erkannt wurde. */
  onRelayDetected?: (link: DiagnosableLink) => void;
  now?: () => number;
}

interface PolledStats {
  localCandidateType: IceCandidateType | null;
  remoteCandidateType: IceCandidateType | null;
  /** Transportprotokoll und Netzwerkart des lokalen Kandidaten, soweit der Browser sie liefert. */
  localProtocol: string | null;
  localNetworkType: string | null;
  rttMs: number | null;
  /**
   * Anzahl beantworteter STUN-Prüfungen. Steigt sie, liegt eine *neue* RTT-Messung vor.
   * Nötig, weil `currentRoundTripTime` nur alle paar Sekunden aktualisiert wird und wir
   * sonst denselben Wert mehrfach in die Statistik zählen würden.
   */
  responsesReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

interface LinkRecord {
  appPings: number[];
  rtts: number[];
  lastResponsesReceived: number;
  rttSampleCount: number;
  stats: PolledStats | null;
  lastIceState: RTCIceConnectionState | null;
  iceBrokenAtMs: number | null;
  disconnects: number;
  backpressure: Record<PeerChannelKind, BackpressureEpisode | null>;
  lastBackpressureLogAtMs: number | null;
  loggedPath: string | null;
  relayReported: boolean;
}

/** Zeitraum, in dem ein Sendepuffer durchgehend über der Beobachtungsschwelle liegt. */
interface BackpressureEpisode {
  startedAtMs: number;
  peakBytes: number;
  /** Nur gemeldete Episoden melden auch Stillstand und Abfluss. */
  logged: boolean;
  stallLogged: boolean;
}

const EMPTY_STATS: PolledStats = {
  localCandidateType: null,
  remoteCandidateType: null,
  localProtocol: null,
  localNetworkType: null,
  rttMs: null,
  responsesReceived: 0,
  bytesSent: 0,
  bytesReceived: 0,
};

function toCandidateType(value: unknown): IceCandidateType | null {
  return value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay' ? value : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Jitter als mittlere absolute Abweichung aufeinanderfolgender Messungen.
 * Bewusst nicht die Standardabweichung: für das Spielgefühl zählt, wie stark die Latenz
 * von Messung zu Messung springt, nicht wie breit sie insgesamt streut.
 */
export function meanConsecutiveDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  let total = 0;
  for (let index = 1; index < values.length; index++) {
    total += Math.abs(values[index] - values[index - 1]);
  }
  return total / (values.length - 1);
}

export class TransportDiagnostics {
  private readonly records = new Map<string, LinkRecord>();
  private nextPollAtMs = 0;
  private pollInFlight = false;

  constructor(private readonly deps: TransportDiagnosticsDeps) {}

  /** Jeden Frame aufrufen; die eigentliche Abfrage läuft gedrosselt und asynchron. */
  update(): void {
    const links = this.deps.getLinks();
    this.pruneRecords(links);
    this.sampleAppPings(links);
    this.trackIceStates(links);
    this.trackBackpressure(links);

    const now = this.now();
    if (now < this.nextPollAtMs || this.pollInFlight) return;
    this.nextPollAtMs = now + PEER_DIAGNOSTICS_POLL_MS;
    this.pollInFlight = true;
    void this.pollAll(links).finally(() => { this.pollInFlight = false; });
  }

  getSnapshots(): LinkDiagnostics[] {
    return this.deps.getLinks().map((link) => this.describe(link));
  }

  /** Verbindung mit der höchsten Netzwerk-RTT. Basis für die Lobby-Anzeige. */
  getWorstSnapshot(): LinkDiagnostics | null {
    const snapshots = this.getSnapshots();
    if (snapshots.length === 0) return null;
    const measured = snapshots.filter(snapshot => snapshot.medianRttMs !== null);
    if (measured.length === 0) return snapshots[0];
    return measured.reduce((worst, candidate) => (
      (candidate.medianRttMs ?? 0) > (worst.medianRttMs ?? 0) ? candidate : worst
    ));
  }

  reset(): void {
    this.records.clear();
    this.nextPollAtMs = 0;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private record(link: DiagnosableLink): LinkRecord {
    let record = this.records.get(link.remotePeerId);
    if (!record) {
      record = {
        appPings: [],
        rtts: [],
        lastResponsesReceived: 0,
        rttSampleCount: 0,
        stats: null,
        lastIceState: null,
        iceBrokenAtMs: null,
        disconnects: 0,
        backpressure: { rel: null, fast: null },
        lastBackpressureLogAtMs: null,
        loggedPath: null,
        relayReported: false,
      };
      this.records.set(link.remotePeerId, record);
    }
    return record;
  }

  private pruneRecords(links: readonly DiagnosableLink[]): void {
    if (this.records.size === 0) return;
    const alive = new Set(links.map((link) => link.remotePeerId));
    for (const peerId of [...this.records.keys()]) {
      if (!alive.has(peerId)) this.records.delete(peerId);
    }
  }

  private sampleAppPings(links: readonly DiagnosableLink[]): void {
    for (const link of links) {
      if (link.playerId.length === 0) continue;
      const ping = this.deps.getAppPingMs(link.playerId);
      if (!Number.isFinite(ping) || ping <= 0) continue;
      const record = this.record(link);
      const pings = record.appPings;
      if (pings.length > 0 && pings[pings.length - 1] === ping) continue; // gleiche Messung, kein neues Sample
      pings.push(ping);
      if (pings.length > PEER_DIAGNOSTICS_SAMPLE_WINDOW) pings.shift();
    }
  }

  private trackIceStates(links: readonly DiagnosableLink[]): void {
    for (const link of links) {
      const state = link.peerConnection?.iceConnectionState;
      if (!state) continue;
      const record = this.record(link);
      if (record.lastIceState === state) continue;
      const previous = record.lastIceState;
      record.lastIceState = state;
      if (previous !== null && (state === 'disconnected' || state === 'failed')) {
        record.disconnects++;
        record.iceBrokenAtMs ??= this.now();
        console.warn(`[Transport] ICE-Zustand ${previous} -> ${state} (peer ${link.remotePeerId}).`);
      } else if (record.iceBrokenAtMs !== null && (state === 'connected' || state === 'completed')) {
        console.info(`[Transport] ICE-Zustand ${previous} -> ${state}, erholt nach ${this.now() - record.iceBrokenAtMs} ms (peer ${link.remotePeerId}).`);
        record.iceBrokenAtMs = null;
      }
    }
  }

  private trackBackpressure(links: readonly DiagnosableLink[]): void {
    for (const link of links) {
      this.trackChannelBackpressure(link, 'rel', link.reliableChannel?.bufferedAmount ?? 0, link.reliableQueuedBytes);
      this.trackChannelBackpressure(link, 'fast', link.unreliableChannel?.bufferedAmount ?? 0, link.fastQueuedBytes);
    }
  }

  /**
   * Trennt einen kurzen Sendestoß von einem Kanal, der nicht mehr abfließt: gemeldet werden
   * Beginn (mit den zuletzt gesendeten Nachrichten), Stillstand nach fester Dauer und Abfluss.
   */
  private trackChannelBackpressure(
    link: DiagnosableLink,
    channel: PeerChannelKind,
    buffered: number,
    queued: number | undefined,
  ): void {
    const existing = this.records.get(link.remotePeerId)?.backpressure[channel] ?? null;
    if (buffered < PEER_DIAGNOSTICS_BACKPRESSURE_BYTES && !existing) return;
    const record = this.record(link);
    const now = this.now();
    const queuedText = queued === undefined ? '' : `, ${queued} B in eigener Warteschlange`;
    const episode = record.backpressure[channel];

    if (!episode) {
      const logged = record.lastBackpressureLogAtMs === null
        || now - record.lastBackpressureLogAtMs >= PEER_DIAGNOSTICS_BACKPRESSURE_LOG_INTERVAL_MS;
      record.backpressure[channel] = { startedAtMs: now, peakBytes: buffered, logged, stallLogged: false };
      if (!logged) return;
      record.lastBackpressureLogAtMs = now;
      console.warn(
        `[Transport] Sendepuffer hoch: Kanal ${channel}, ${buffered} B${queuedText} (peer ${link.remotePeerId}). `
        + `Zuletzt gesendet: ${formatRecentSends(link.recentSends ?? [], Date.now())}.`,
      );
      return;
    }

    const durationMs = now - episode.startedAtMs;
    if (buffered < PEER_DIAGNOSTICS_BACKPRESSURE_BYTES) {
      record.backpressure[channel] = null;
      if (episode.logged) {
        console.info(`[Transport] Sendepuffer abgeflossen: Kanal ${channel} nach ${durationMs} ms, Spitze ${episode.peakBytes} B (peer ${link.remotePeerId}).`);
      }
      return;
    }

    episode.peakBytes = Math.max(episode.peakBytes, buffered);
    if (episode.logged && !episode.stallLogged && durationMs >= PEER_DIAGNOSTICS_BACKPRESSURE_STALL_MS) {
      episode.stallLogged = true;
      const iceState = link.peerConnection?.iceConnectionState ?? '?';
      console.warn(
        `[Transport] Sendepuffer fließt nicht ab: Kanal ${channel} seit ${durationMs} ms über der Schwelle, `
        + `jetzt ${buffered} B${queuedText}, ICE ${iceState} (peer ${link.remotePeerId}). `
        + `Zuletzt gesendet: ${formatRecentSends(link.recentSends ?? [], Date.now())}.`,
      );
    }
  }

  /** Meldet den gewählten Pfad einmal und bei jedem Wechsel des Kandidatenpaars. */
  private trackPath(link: DiagnosableLink, record: LinkRecord, stats: PolledStats): void {
    if (stats.localCandidateType === null) return;
    const local = [stats.localCandidateType, stats.localProtocol, stats.localNetworkType].filter(Boolean).join('/');
    const path = `lokal=${local}, remote=${stats.remoteCandidateType ?? '?'}`;
    if (record.loggedPath === path) return;
    const previous = record.loggedPath;
    record.loggedPath = path;
    const rtt = stats.rttMs === null ? '' : `, RTT ${stats.rttMs.toFixed(1)} ms`;
    const change = previous === null ? '' : `gewechselt (vorher ${previous}) `;
    console.info(`[Transport] ICE-Pfad ${change}${path}${rtt} (peer ${link.remotePeerId}).`);
  }

  private async pollAll(links: readonly DiagnosableLink[]): Promise<void> {
    await Promise.all(links.map((link) => this.pollLink(link)));
  }

  private async pollLink(link: DiagnosableLink): Promise<void> {
    const peerConnection = link.peerConnection;
    if (!peerConnection) return;

    let report: RTCStatsReport;
    try {
      report = await peerConnection.getStats();
    } catch {
      return; // Verbindung wurde waehrend der Abfrage geschlossen.
    }

    const stats = readSelectedPairStats(report);
    const record = this.record(link);
    record.stats = stats;
    this.trackPath(link, record, stats);

    // Nur echte Neumessungen zaehlen. 0 ms ist dabei ein gueltiger Wert – im selben LAN
    // oder gar auf demselben Rechner liegt die RTT unter einer Millisekunde.
    if (stats.rttMs !== null && stats.responsesReceived > record.lastResponsesReceived) {
      record.lastResponsesReceived = stats.responsesReceived;
      record.rttSampleCount++;
      record.rtts.push(stats.rttMs);
      if (record.rtts.length > PEER_DIAGNOSTICS_SAMPLE_WINDOW) record.rtts.shift();
    }

    const usesRelay = stats.localCandidateType === 'relay' || stats.remoteCandidateType === 'relay';
    if (usesRelay && !record.relayReported) {
      record.relayReported = true;
      console.error(
        `[Transport] Relay-Kandidat erkannt (lokal=${stats.localCandidateType}, remote=${stats.remoteCandidateType}). `
        + 'Es ist kein TURN konfiguriert – das ist ein Konfigurationsfehler.',
      );
      this.deps.onRelayDetected?.(link);
    }
  }

  private describe(link: DiagnosableLink): LinkDiagnostics {
    const record = this.records.get(link.remotePeerId);
    const stats = record?.stats ?? EMPTY_STATS;
    const appPings = record?.appPings ?? [];
    const rtts = record?.rtts ?? [];
    const reliableBufferedBytes = link.reliableChannel?.bufferedAmount ?? 0;
    const fastBufferedBytes = link.unreliableChannel?.bufferedAmount ?? 0;

    return {
      playerId: link.playerId,
      peerId: link.remotePeerId,
      connectionState: link.peerConnection?.connectionState ?? 'unknown',
      iceConnectionState: link.peerConnection?.iceConnectionState ?? 'unknown',
      reliableChannelState: link.reliableChannel?.readyState ?? 'missing',
      fastChannelState: link.unreliableChannel?.readyState ?? 'missing',
      localCandidateType: stats.localCandidateType,
      remoteCandidateType: stats.remoteCandidateType,
      usesRelay: stats.localCandidateType === 'relay' || stats.remoteCandidateType === 'relay',
      rttMs: stats.rttMs,
      medianRttMs: median(rtts),
      maxRttMs: rtts.length > 0 ? Math.max(...rtts) : null,
      jitterRttMs: meanConsecutiveDeviation(rtts),
      rttSampleCount: record?.rttSampleCount ?? 0,
      medianAppPingMs: median(appPings),
      maxAppPingMs: appPings.length > 0 ? Math.max(...appPings) : null,
      jitterAppPingMs: meanConsecutiveDeviation(appPings),
      appPingSampleCount: appPings.length,
      connectDurationMs: link.openedAtMs > 0 ? link.openedAtMs - link.createdAtMs : null,
      disconnectCount: record?.disconnects ?? 0,
      bytesSent: stats.bytesSent,
      bytesReceived: stats.bytesReceived,
      reliableBufferedBytes,
      fastBufferedBytes,
      backpressure: Math.max(reliableBufferedBytes, fastBufferedBytes) >= PEER_DIAGNOSTICS_BACKPRESSURE_BYTES,
      droppedFastMessages: link.droppedFastCount,
    };
  }
}

interface CandidatePairStatsLike {
  id: string;
  type: string;
  state?: string;
  nominated?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
  currentRoundTripTime?: number;
  responsesReceived?: number;
  bytesSent?: number;
  bytesReceived?: number;
}

interface CandidateStatsLike {
  id: string;
  type: string;
  candidateType?: string;
  protocol?: string;
  networkType?: string;
}

interface TransportStatsLike {
  type: string;
  selectedCandidatePairId?: string;
}

/**
 * Liest das tatsächlich verwendete Kandidatenpaar. Bevorzugt wird die Auswahl des
 * Transports; nicht alle Browser liefern sie, deshalb bleibt das nominierte, erfolgreiche
 * Paar als Rückfall.
 */
export function readSelectedPairStats(report: RTCStatsReport): PolledStats {
  const pairs = new Map<string, CandidatePairStatsLike>();
  const candidates = new Map<string, CandidateStatsLike>();
  let selectedPairId: string | undefined;

  report.forEach((entry: unknown) => {
    const stat = entry as { id?: string; type?: string };
    if (typeof stat.id !== 'string' || typeof stat.type !== 'string') return;
    if (stat.type === 'candidate-pair') pairs.set(stat.id, stat as CandidatePairStatsLike);
    else if (stat.type === 'local-candidate' || stat.type === 'remote-candidate') candidates.set(stat.id, stat as CandidateStatsLike);
    else if (stat.type === 'transport') selectedPairId = (stat as TransportStatsLike).selectedCandidatePairId;
  });

  let pair = selectedPairId !== undefined ? pairs.get(selectedPairId) : undefined;
  if (!pair) {
    for (const candidate of pairs.values()) {
      if (candidate.state !== 'succeeded') continue;
      if (!pair || candidate.nominated === true) pair = candidate;
      if (candidate.nominated === true) break;
    }
  }
  if (!pair) return { ...EMPTY_STATS };

  const local = pair.localCandidateId !== undefined ? candidates.get(pair.localCandidateId) : undefined;
  const remote = pair.remoteCandidateId !== undefined ? candidates.get(pair.remoteCandidateId) : undefined;

  return {
    localCandidateType: toCandidateType(local?.candidateType),
    remoteCandidateType: toCandidateType(remote?.candidateType),
    localProtocol: typeof local?.protocol === 'string' ? local.protocol : null,
    localNetworkType: typeof local?.networkType === 'string' ? local.networkType : null,
    // WebRTC liefert Sekunden, angezeigt werden Millisekunden.
    rttMs: typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
    responsesReceived: pair.responsesReceived ?? 0,
    bytesSent: pair.bytesSent ?? 0,
    bytesReceived: pair.bytesReceived ?? 0,
  };
}
