import type { NetworkPingSample } from './NetworkBridge';
import type { PlayerProfile, RoomQualitySnapshot, RoomQualityStatus } from '../types';
import {
  ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS,
  ROOM_QUALITY_REQUIRED_SAMPLES,
  ROOM_QUALITY_SAMPLE_INTERVAL_MS,
  ROOM_QUALITY_START_POLICY,
} from '../config';

interface RoomQualityBridge {
  isHost(): boolean;
  getLocalPlayerId(): string;
  getPlayerPingSample(playerId: string): NetworkPingSample | null;
  getRoomQuality(): RoomQualitySnapshot | null;
  publishRoomQuality(snapshot: RoomQualitySnapshot | null): void;
}

export class RoomQualityMonitor {
  private roomQualitySamples = new Map<string, number[]>();
  private lastPingSampleSequences = new Map<string, number>();
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  private nextRoomQualitySampleAt = 0;

  constructor(private readonly bridge: RoomQualityBridge) {}

  initialize(now: number): void {
    this.roomQualitySamples.clear();
    this.lastPingSampleSequences.clear();
    this.nextRoomQualitySampleAt = now;
    if (!this.bridge.isHost()) {
      this.roomQualitySnapshot = this.bridge.getRoomQuality();
      return;
    }
    this.publish(this.buildSnapshot('waiting', 'Pingmessung startet, sobald ein Mitspieler verbunden ist.', null, 0, 0, 0));
  }

  update(now: number, players: PlayerProfile[]): RoomQualitySnapshot | null {
    if (!this.bridge.isHost()) {
      this.roomQualitySnapshot = this.bridge.getRoomQuality();
      return this.roomQualitySnapshot;
    }

    const remotePlayers = players.filter(player => player.id !== this.bridge.getLocalPlayerId());
    const remoteIds = new Set(remotePlayers.map(player => player.id));
    for (const playerId of this.roomQualitySamples.keys()) {
      if (!remoteIds.has(playerId)) {
        this.roomQualitySamples.delete(playerId);
        this.lastPingSampleSequences.delete(playerId);
      }
    }

    if (remotePlayers.length === 0) {
      this.publish(this.buildSnapshot('waiting', 'Pingmessung startet, sobald ein Mitspieler verbunden ist.', null, 0, players.length, 0));
      return this.roomQualitySnapshot;
    }

    if (now >= this.nextRoomQualitySampleAt) {
      this.nextRoomQualitySampleAt = now + ROOM_QUALITY_SAMPLE_INTERVAL_MS;
      for (const player of remotePlayers) {
        const publishedSample = this.bridge.getPlayerPingSample(player.id);
        if (!publishedSample) continue;
        const lastSequence = this.lastPingSampleSequences.get(player.id) ?? 0;
        if (publishedSample.s <= lastSequence) continue;
        this.lastPingSampleSequences.set(player.id, publishedSample.s);
        const ping = publishedSample.m;
        // 0 ms ist ein echtes Ergebnis und muss zaehlen, sonst kaeme eine LAN-Runde nie
        // ueber den Status 'sampling' hinaus.
        const samples = this.roomQualitySamples.get(player.id) ?? [];
        samples.push(ping);
        if (samples.length > ROOM_QUALITY_REQUIRED_SAMPLES) samples.shift();
        this.roomQualitySamples.set(player.id, samples);
      }
    }

    const sampleCounts = remotePlayers.map(player => this.roomQualitySamples.get(player.id)?.length ?? 0);
    const measuredPlayers = sampleCounts.filter(count => count > 0).length;
    const minSamplesCollected = Math.min(...sampleCounts);

    if (minSamplesCollected < ROOM_QUALITY_REQUIRED_SAMPLES) {
      this.publish(this.buildSnapshot(
        'sampling',
        `Raumtest misst ${measuredPlayers}/${remotePlayers.length} Spieler (${minSamplesCollected}/${ROOM_QUALITY_REQUIRED_SAMPLES} Samples).`,
        null,
        measuredPlayers,
        players.length,
        minSamplesCollected,
      ));
      return this.roomQualitySnapshot;
    }

    const worstPingMs = Math.round(Math.max(...remotePlayers.map(player => {
      const samples = this.roomQualitySamples.get(player.id) ?? [];
      return samples.reduce((sum, value) => sum + value, 0) / samples.length;
    })));
    const status: RoomQualityStatus = worstPingMs <= ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS ? 'good' : 'bad';
    const relation = status === 'good' ? '<=' : '>';
    this.publish(this.buildSnapshot(
      status,
      `Raumtest ${status === 'good' ? 'ok' : 'zu hoch'} (${worstPingMs}ms ${relation} ${ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS}ms).`,
      worstPingMs,
      remotePlayers.length,
      players.length,
      minSamplesCollected,
    ));
    return this.roomQualitySnapshot;
  }

  getSnapshot(): RoomQualitySnapshot | null {
    return this.roomQualitySnapshot;
  }

  shouldBlockStart(): boolean {
    return !!this.roomQualitySnapshot?.startBlocked && this.roomQualitySnapshot.status !== 'good';
  }

  private buildSnapshot(
    status: RoomQualityStatus,
    summary: string,
    worstPingMs: number | null,
    measuredPlayers: number,
    totalPlayers: number,
    minSamplesCollected: number,
  ): RoomQualitySnapshot {
    return {
      status,
      summary,
      source: 'webrtc',
      thresholdMs: ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS,
      worstPingMs,
      measuredPlayers,
      totalPlayers,
      minSamplesCollected,
      requiredSamples: ROOM_QUALITY_REQUIRED_SAMPLES,
      startBlocked: ROOM_QUALITY_START_POLICY === 'block',
    };
  }

  private publish(snapshot: RoomQualitySnapshot): void {
    const previous = this.roomQualitySnapshot ? JSON.stringify(this.roomQualitySnapshot) : null;
    const next = JSON.stringify(snapshot);
    this.roomQualitySnapshot = snapshot;
    if (previous !== next) this.bridge.publishRoomQuality(snapshot);
  }
}
