import type { PlayerProfile, RoomQualitySnapshot, RoomQualityStatus } from '../types';
import {
  ROOM_QUALITY_AUTO_RETRY_DELAY_MS,
  ROOM_QUALITY_HOST_PROBE_SAMPLE_COUNT,
  ROOM_QUALITY_HOST_PROBE_TIMEOUT_MS,
  ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS,
  ROOM_QUALITY_MAX_AUTO_RETRIES,
  ROOM_QUALITY_REQUIRED_SAMPLES,
  ROOM_QUALITY_RETRY_MODE,
  ROOM_QUALITY_SAMPLE_INTERVAL_MS,
  ROOM_QUALITY_START_POLICY,
} from '../config';
import type { HostRoomQualityProbeResult } from './NetworkPingController';
import type { AutomaticRoomSearchState } from '../utils/roomQuality';

interface RoomQualityBridge {
  isHost(): boolean;
  getLocalPlayerId(): string;
  getPlayerPing(playerId: string): number;
  getRoomQuality(): RoomQualitySnapshot | null;
  publishRoomQuality(snapshot: RoomQualitySnapshot | null): void;
  measureHostRoomLoopback(sampleCount: number, timeoutMs: number): Promise<HostRoomQualityProbeResult>;
}

interface RoomQualityMonitorDeps {
  bridge: RoomQualityBridge;
  getRetryCount: () => number;
  clearRetryCount: () => void;
  restartRoomForQualityRetry: () => void;
  restartRoomForAutomaticRoomSearch: () => void;
  getAutomaticRoomSearchState: () => AutomaticRoomSearchState;
  consumeAutomaticRoomSearchAttempt: () => AutomaticRoomSearchState;
  clearAutomaticRoomSearchState: () => void;
  markAutomaticRoomSearchExhausted: () => AutomaticRoomSearchState;
}

export class RoomQualityMonitor {
  private roomQualitySamples = new Map<string, number[]>();
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  private nextRoomQualitySampleAt = 0;
  private autoRetryAtMs: number | null = null;
  private autoRetryTriggered = false;
  private hostSoloProbeInFlight = false;
  private hostSoloProbeEstimateMs: number | null = null;
  private hostSoloProbeLoopbackMs: number | null = null;
  private hostSoloProbeSampleCount = 0;
  private hostSoloProbeAttempted = false;

  constructor(private deps: RoomQualityMonitorDeps) {}

  initialize(now: number): void {
    this.roomQualitySamples.clear();
    this.nextRoomQualitySampleAt = now + ROOM_QUALITY_SAMPLE_INTERVAL_MS;
    this.autoRetryAtMs = null;
    this.autoRetryTriggered = false;
    this.hostSoloProbeInFlight = false;
    this.hostSoloProbeEstimateMs = null;
    this.hostSoloProbeLoopbackMs = null;
    this.hostSoloProbeSampleCount = 0;
    this.hostSoloProbeAttempted = false;

    if (!this.deps.bridge.isHost()) {
      this.roomQualitySnapshot = this.deps.bridge.getRoomQuality();
      return;
    }

    const autoSearchState = this.deps.getAutomaticRoomSearchState();
    if (autoSearchState.active && !autoSearchState.exhausted) {
      this.deps.consumeAutomaticRoomSearchAttempt();
    }

    this.publishRoomQuality(this.buildSnapshot('sampling', 'Host-Probe startet…', null, 0, 0, 0, 'host-proxy'));
    void this.startHostSoloProbe();
  }

  update(now: number, players: PlayerProfile[]): RoomQualitySnapshot | null {
    if (!this.deps.bridge.isHost()) {
      this.roomQualitySnapshot = this.deps.bridge.getRoomQuality();
      return this.roomQualitySnapshot;
    }

    const remotePlayers = players.filter(player => player.id !== this.deps.bridge.getLocalPlayerId());
    const remoteIds = new Set(remotePlayers.map(player => player.id));
    for (const playerId of [...this.roomQualitySamples.keys()]) {
      if (!remoteIds.has(playerId)) this.roomQualitySamples.delete(playerId);
    }

    if (remotePlayers.length === 0) {
      this.updateHostSoloRoomQuality(now, players.length);
      return this.roomQualitySnapshot;
    }

    if (now >= this.nextRoomQualitySampleAt) {
      this.nextRoomQualitySampleAt = now + ROOM_QUALITY_SAMPLE_INTERVAL_MS;
      for (const player of remotePlayers) {
        const ping = this.deps.bridge.getPlayerPing(player.id);
        if (ping <= 0) continue;
        const samples = this.roomQualitySamples.get(player.id) ?? [];
        samples.push(ping);
        if (samples.length > ROOM_QUALITY_REQUIRED_SAMPLES) samples.shift();
        this.roomQualitySamples.set(player.id, samples);
      }
    }

    const sampleCounts = remotePlayers.map(player => this.roomQualitySamples.get(player.id)?.length ?? 0);
    const measuredPlayers = sampleCounts.filter(count => count > 0).length;
    const minSamplesCollected = sampleCounts.length > 0 ? Math.min(...sampleCounts) : 0;

    if (minSamplesCollected < ROOM_QUALITY_REQUIRED_SAMPLES) {
      this.autoRetryAtMs = null;
      this.autoRetryTriggered = false;
      this.publishRoomQuality(
        this.buildSnapshot(
          'sampling',
          `Raumtest misst ${measuredPlayers}/${remotePlayers.length} Spieler (${minSamplesCollected}/${ROOM_QUALITY_REQUIRED_SAMPLES} Samples)`,
          null,
          measuredPlayers,
          players.length,
          minSamplesCollected,
          'team-ping',
        ),
      );
      return this.roomQualitySnapshot;
    }

    const worstPingMs = Math.round(Math.max(...remotePlayers.map(player => {
      const samples = this.roomQualitySamples.get(player.id) ?? [];
      const total = samples.reduce((sum, value) => sum + value, 0);
      return total / Math.max(1, samples.length);
    })));

    if (worstPingMs <= ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS) {
      this.deps.clearRetryCount();
      this.deps.clearAutomaticRoomSearchState();
      this.autoRetryAtMs = null;
      this.autoRetryTriggered = false;
      this.publishRoomQuality(
        this.buildSnapshot(
          'good',
          `Raumtest ok (${worstPingMs}ms <= ${ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS}ms)`,
          worstPingMs,
          remotePlayers.length,
          players.length,
          minSamplesCollected,
          'team-ping',
        ),
      );
      return this.roomQualitySnapshot;
    }

    const autoSearchState = this.deps.getAutomaticRoomSearchState();
    if (autoSearchState.active) {
      this.handleAutomaticSearchFailure(now, worstPingMs, remotePlayers.length, players.length, minSamplesCollected, 'team-ping');
      return this.roomQualitySnapshot;
    }

    const retryCount = this.deps.getRetryCount();
    if (ROOM_QUALITY_RETRY_MODE === 'auto' && retryCount < ROOM_QUALITY_MAX_AUTO_RETRIES) {
      if (this.autoRetryAtMs === null) {
        this.autoRetryAtMs = now + ROOM_QUALITY_AUTO_RETRY_DELAY_MS;
        this.autoRetryTriggered = false;
      }
      this.publishRoomQuality(
        this.buildSnapshot(
          'retrying',
          `Raumtest schlecht (${worstPingMs}ms) - neuer Raum folgt`,
          worstPingMs,
          remotePlayers.length,
          players.length,
          minSamplesCollected,
          'team-ping',
        ),
      );
      if (!this.autoRetryTriggered && now >= this.autoRetryAtMs) {
        this.autoRetryTriggered = true;
        this.deps.restartRoomForQualityRetry();
      }
      return this.roomQualitySnapshot;
    }

    this.autoRetryAtMs = null;
    this.autoRetryTriggered = false;
    const retryHint = retryCount >= ROOM_QUALITY_MAX_AUTO_RETRIES
      ? ' - Auto-Retry-Limit erreicht'
      : ' - neuer Raum empfohlen';
    this.publishRoomQuality(
      this.buildSnapshot(
        'bad',
        `Raumtest schlecht (${worstPingMs}ms > ${ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS}ms)${retryHint}`,
        worstPingMs,
        remotePlayers.length,
        players.length,
        minSamplesCollected,
        'team-ping',
      ),
    );
    return this.roomQualitySnapshot;
  }

  getSnapshot(): RoomQualitySnapshot | null {
    return this.roomQualitySnapshot;
  }

  shouldBlockStart(): boolean {
    return !!this.roomQualitySnapshot?.startBlocked && this.roomQualitySnapshot.status !== 'good';
  }

  private updateHostSoloRoomQuality(now: number, totalPlayers: number): void {
    const retryCount = this.deps.getRetryCount();
    if (!this.hostSoloProbeAttempted && !this.hostSoloProbeInFlight) {
      void this.startHostSoloProbe();
    }

    if (this.hostSoloProbeInFlight || !this.hostSoloProbeAttempted) {
      this.autoRetryAtMs = null;
      this.autoRetryTriggered = false;
      this.publishRoomQuality(this.buildSnapshot('sampling', 'Host-Probe misst Raumqualitaet…', null, 0, totalPlayers, 0, 'host-proxy'));
      return;
    }

    if (this.hostSoloProbeEstimateMs === null) {
      this.autoRetryAtMs = null;
      this.autoRetryTriggered = false;
      this.publishRoomQuality(this.buildSnapshot('waiting', 'Host-Probe ohne Ergebnis - Link kann trotzdem geteilt werden', null, 0, totalPlayers, 0, 'host-proxy'));
      return;
    }

    const summaryDetails = this.hostSoloProbeLoopbackMs !== null
      ? `Loopback ${this.hostSoloProbeLoopbackMs}ms`
      : `Host-Probe ${this.hostSoloProbeEstimateMs}ms`;

    if (this.hostSoloProbeEstimateMs <= ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS) {
      this.deps.clearRetryCount();
      this.deps.clearAutomaticRoomSearchState();
      this.autoRetryAtMs = null;
      this.autoRetryTriggered = false;
      this.publishRoomQuality(this.buildSnapshot('good', `Host-Probe ok: ${summaryDetails}`, this.hostSoloProbeEstimateMs, 0, totalPlayers, this.hostSoloProbeSampleCount, 'host-proxy'));
      return;
    }

    const autoSearchState = this.deps.getAutomaticRoomSearchState();
    if (autoSearchState.active) {
      this.handleAutomaticSearchFailure(now, this.hostSoloProbeEstimateMs, 0, totalPlayers, this.hostSoloProbeSampleCount, 'host-proxy', summaryDetails);
      return;
    }

    if (ROOM_QUALITY_RETRY_MODE === 'auto' && retryCount < ROOM_QUALITY_MAX_AUTO_RETRIES) {
      if (this.autoRetryAtMs === null) {
        this.autoRetryAtMs = now + ROOM_QUALITY_AUTO_RETRY_DELAY_MS;
        this.autoRetryTriggered = false;
      }
      this.publishRoomQuality(this.buildSnapshot('retrying', `Host-Probe schlecht: ${summaryDetails} - neuer Raum folgt`, this.hostSoloProbeEstimateMs, 0, totalPlayers, this.hostSoloProbeSampleCount, 'host-proxy'));
      if (!this.autoRetryTriggered && now >= this.autoRetryAtMs) {
        this.autoRetryTriggered = true;
        this.deps.restartRoomForQualityRetry();
      }
      return;
    }

    this.autoRetryAtMs = null;
    this.autoRetryTriggered = false;
    const retryHint = retryCount >= ROOM_QUALITY_MAX_AUTO_RETRIES
      ? ' - Auto-Retry-Limit erreicht'
      : ' - neuer Raum empfohlen';
    this.publishRoomQuality(this.buildSnapshot('bad', `Host-Probe schlecht: ${summaryDetails}${retryHint}`, this.hostSoloProbeEstimateMs, 0, totalPlayers, this.hostSoloProbeSampleCount, 'host-proxy'));
  }

  private async startHostSoloProbe(): Promise<void> {
    if (!this.deps.bridge.isHost() || this.hostSoloProbeInFlight) return;
    this.hostSoloProbeInFlight = true;
    this.hostSoloProbeAttempted = true;
    try {
      const result = await this.deps.bridge.measureHostRoomLoopback(
        ROOM_QUALITY_HOST_PROBE_SAMPLE_COUNT,
        ROOM_QUALITY_HOST_PROBE_TIMEOUT_MS,
      );
      this.hostSoloProbeEstimateMs = result.estimateMs;
      this.hostSoloProbeLoopbackMs = result.loopbackAverageMs;
      this.hostSoloProbeSampleCount = result.successfulLoopbackSamples;
    } finally {
      this.hostSoloProbeInFlight = false;
    }
  }

  private buildSnapshot(
    status: RoomQualityStatus,
    summary: string,
    worstPingMs: number | null,
    measuredPlayers: number,
    totalPlayers: number,
    minSamplesCollected = 0,
    source: RoomQualitySnapshot['source'] = 'team-ping',
  ): RoomQualitySnapshot {
    const autoSearchState = this.deps.getAutomaticRoomSearchState();
    return {
      status,
      summary,
      source,
      autoSearchActive: autoSearchState.active,
      autoSearchAttempt: autoSearchState.currentAttempt,
      autoSearchMaxAttempts: autoSearchState.maxAttempts,
      autoSearchExhausted: autoSearchState.exhausted,
      thresholdMs: ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS,
      worstPingMs,
      measuredPlayers,
      totalPlayers,
      minSamplesCollected,
      requiredSamples: ROOM_QUALITY_REQUIRED_SAMPLES,
      retryCount: this.deps.getRetryCount(),
      retryMode: ROOM_QUALITY_RETRY_MODE,
      startBlocked: ROOM_QUALITY_START_POLICY === 'block',
    };
  }

  private handleAutomaticSearchFailure(
    now: number,
    pingMs: number,
    measuredPlayers: number,
    totalPlayers: number,
    minSamplesCollected: number,
    source: RoomQualitySnapshot['source'],
    customSummary?: string,
  ): void {
    const autoSearchState = this.deps.getAutomaticRoomSearchState();
    const baseSummary = customSummary ?? `${pingMs}ms > ${ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS}ms`;

    if (autoSearchState.currentAttempt < autoSearchState.maxAttempts) {
      if (this.autoRetryAtMs === null) {
        this.autoRetryAtMs = now + ROOM_QUALITY_AUTO_RETRY_DELAY_MS;
        this.autoRetryTriggered = false;
      }
      this.publishRoomQuality(
        this.buildSnapshot(
          'retrying',
          `Auto-Suche ${autoSearchState.currentAttempt}/${autoSearchState.maxAttempts}: ${baseSummary} - neuer Raum folgt`,
          pingMs,
          measuredPlayers,
          totalPlayers,
          minSamplesCollected,
          source,
        ),
      );
      if (!this.autoRetryTriggered && now >= this.autoRetryAtMs) {
        this.autoRetryTriggered = true;
        this.deps.restartRoomForAutomaticRoomSearch();
      }
      return;
    }

    this.autoRetryAtMs = null;
    this.autoRetryTriggered = false;
    const exhaustedState = this.deps.markAutomaticRoomSearchExhausted();
    this.publishRoomQuality(
      this.buildSnapshot(
        'bad',
        `Auto-Suche erfolglos: kein guter Raum nach ${exhaustedState.maxAttempts} Versuchen`,
        pingMs,
        measuredPlayers,
        totalPlayers,
        minSamplesCollected,
        source,
      ),
    );
  }

  private publishRoomQuality(snapshot: RoomQualitySnapshot): void {
    const previous = this.roomQualitySnapshot ? JSON.stringify(this.roomQualitySnapshot) : null;
    const next = JSON.stringify(snapshot);
    this.roomQualitySnapshot = snapshot;
    if (previous === next) return;
    this.deps.bridge.publishRoomQuality(snapshot);
  }
}