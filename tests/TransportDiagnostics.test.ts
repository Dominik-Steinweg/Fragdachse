import { describe, expect, it, vi } from 'vitest';
import {
  TransportDiagnostics,
  meanConsecutiveDeviation,
  median,
  readSelectedPairStats,
  type DiagnosableLink,
} from '../src/network/peer/TransportDiagnostics';
import {
  PEER_DIAGNOSTICS_BACKPRESSURE_BYTES,
  PEER_DIAGNOSTICS_POLL_MS,
  PEER_DIAGNOSTICS_SAMPLE_WINDOW,
} from '../src/config';

/** Minimaler RTCStatsReport: eine Map reicht, getStats() liefert genau dieses Interface. */
function statsReport(entries: Array<Record<string, unknown>>): RTCStatsReport {
  return new Map(entries.map((entry) => [entry.id as string, entry])) as unknown as RTCStatsReport;
}

function candidatePairReport(localType: string, remoteType: string, extra: Record<string, unknown> = {}): RTCStatsReport {
  return statsReport([
    { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
    {
      id: 'P1',
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      localCandidateId: 'L1',
      remoteCandidateId: 'R1',
      currentRoundTripTime: 0.024,
      bytesSent: 2048,
      bytesReceived: 4096,
      ...extra,
    },
    { id: 'L1', type: 'local-candidate', candidateType: localType },
    { id: 'R1', type: 'remote-candidate', candidateType: remoteType },
  ]);
}

class FakeChannel {
  bufferedAmount = 0;
  constructor(public readyState: RTCDataChannelState = 'open') {}
}

class FakeLink implements DiagnosableLink {
  readonly createdAtMs = 1_000;
  openedAtMs = 1_350;
  reliableChannel = new FakeChannel() as unknown as RTCDataChannel;
  unreliableChannel = new FakeChannel() as unknown as RTCDataChannel;
  droppedFastCount = 0;
  closed = false;
  iceConnectionState: RTCIceConnectionState = 'connected';
  connectionState: RTCPeerConnectionState = 'connected';
  private report: RTCStatsReport = candidatePairReport('host', 'host');

  constructor(readonly remotePeerId: string, public playerId: string) {}

  close(): void {
    this.closed = true;
  }

  setReport(report: RTCStatsReport): void {
    this.report = report;
  }

  get peerConnection(): RTCPeerConnection {
    return {
      connectionState: this.connectionState,
      iceConnectionState: this.iceConnectionState,
      getStats: () => Promise.resolve(this.report),
    } as unknown as RTCPeerConnection;
  }
}

interface Harness {
  diagnostics: TransportDiagnostics;
  link: FakeLink;
  pings: number[];
  relayReports: string[];
  advance: (ms: number) => void;
  poll: () => Promise<void>;
}

function createHarness(): Harness {
  const link = new FakeLink('peer-a', 'p1');
  const pings: number[] = [];
  const relayReports: string[] = [];
  let now = 10_000;

  const diagnostics = new TransportDiagnostics({
    getLinks: () => [link],
    getAppPingMs: () => pings[pings.length - 1] ?? 0,
    onRelayDetected: (detected) => relayReports.push(detected.remotePeerId),
    now: () => now,
  });

  return {
    diagnostics,
    link,
    pings,
    relayReports,
    advance: (ms: number) => { now += ms; },
    poll: async () => {
      diagnostics.update();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('statistics helpers', () => {
  it('computes the median for odd and even sample counts', () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('reports jitter as the mean deviation between consecutive samples', () => {
    expect(meanConsecutiveDeviation([10])).toBeNull();
    expect(meanConsecutiveDeviation([10, 10, 10])).toBe(0);
    expect(meanConsecutiveDeviation([10, 20, 10])).toBe(10);
    // Eine breite, aber gleichmaessig steigende Reihe hat wenig Jitter im Sinne von Sprunghaftigkeit.
    expect(meanConsecutiveDeviation([10, 11, 12, 13])).toBe(1);
  });
});

describe('readSelectedPairStats', () => {
  it('reads the pair the transport selected', () => {
    const stats = readSelectedPairStats(candidatePairReport('srflx', 'host'));
    expect(stats).toEqual({
      localCandidateType: 'srflx',
      remoteCandidateType: 'host',
      webrtcRttMs: 24,
      bytesSent: 2048,
      bytesReceived: 4096,
    });
  });

  it('falls back to the nominated succeeded pair when no transport stat exists', () => {
    const report = statsReport([
      { id: 'P0', type: 'candidate-pair', state: 'failed', localCandidateId: 'L0', remoteCandidateId: 'R0' },
      {
        id: 'P1',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'L1',
        remoteCandidateId: 'R1',
        currentRoundTripTime: 0.008,
      },
      { id: 'L0', type: 'local-candidate', candidateType: 'relay' },
      { id: 'R0', type: 'remote-candidate', candidateType: 'relay' },
      { id: 'L1', type: 'local-candidate', candidateType: 'host' },
      { id: 'R1', type: 'remote-candidate', candidateType: 'host' },
    ]);

    const stats = readSelectedPairStats(report);
    expect(stats.localCandidateType).toBe('host');
    expect(stats.webrtcRttMs).toBe(8);
  });

  it('returns empty values when no pair succeeded', () => {
    const stats = readSelectedPairStats(statsReport([{ id: 'P0', type: 'candidate-pair', state: 'in-progress' }]));
    expect(stats.localCandidateType).toBeNull();
    expect(stats.webrtcRttMs).toBeNull();
  });
});

describe('TransportDiagnostics', () => {
  it('exposes candidate types, rtt and connect time once polled', async () => {
    const harness = createHarness();
    harness.link.setReport(candidatePairReport('srflx', 'srflx'));
    await harness.poll();

    const [snapshot] = harness.diagnostics.getSnapshots();
    expect(snapshot.playerId).toBe('p1');
    expect(snapshot.localCandidateType).toBe('srflx');
    expect(snapshot.usesRelay).toBe(false);
    expect(snapshot.webrtcRttMs).toBe(24);
    expect(snapshot.connectDurationMs).toBe(350);
    expect(snapshot.bytesSent).toBe(2048);
  });

  it('rejects a relay candidate exactly once', async () => {
    const harness = createHarness();
    harness.link.setReport(candidatePairReport('relay', 'host'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await harness.poll();
    harness.advance(PEER_DIAGNOSTICS_POLL_MS);
    await harness.poll();

    expect(harness.relayReports).toEqual(['peer-a']);
    expect(harness.diagnostics.getSnapshots()[0].usesRelay).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('aggregates app pings into median, maximum and jitter', () => {
    const harness = createHarness();
    for (const ping of [20, 30, 25]) {
      harness.pings.push(ping);
      harness.diagnostics.update();
    }

    const [snapshot] = harness.diagnostics.getSnapshots();
    expect(snapshot.pingSampleCount).toBe(3);
    expect(snapshot.medianPingMs).toBe(25);
    expect(snapshot.maxPingMs).toBe(30);
    expect(snapshot.jitterMs).toBe(7.5);
  });

  it('keeps the ping window bounded', () => {
    const harness = createHarness();
    for (let index = 0; index < PEER_DIAGNOSTICS_SAMPLE_WINDOW + 25; index++) {
      harness.pings.push(10 + (index % 7));
      harness.diagnostics.update();
    }

    expect(harness.diagnostics.getSnapshots()[0].pingSampleCount).toBe(PEER_DIAGNOSTICS_SAMPLE_WINDOW);
  });

  it('ignores unmeasured pings instead of recording zeros', () => {
    const harness = createHarness();
    harness.diagnostics.update();
    harness.diagnostics.update();

    const [snapshot] = harness.diagnostics.getSnapshots();
    expect(snapshot.pingSampleCount).toBe(0);
    expect(snapshot.medianPingMs).toBeNull();
  });

  it('counts transitions into a broken ice state', () => {
    const harness = createHarness();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    harness.diagnostics.update();
    harness.link.iceConnectionState = 'disconnected';
    harness.diagnostics.update();
    harness.diagnostics.update();
    harness.link.iceConnectionState = 'connected';
    harness.diagnostics.update();
    harness.link.iceConnectionState = 'failed';
    harness.diagnostics.update();

    expect(harness.diagnostics.getSnapshots()[0].disconnectCount).toBe(2);
    consoleWarn.mockRestore();
  });

  it('flags a send buffer that grew past the observation threshold', () => {
    const harness = createHarness();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(harness.diagnostics.getSnapshots()[0].backpressure).toBe(false);
    (harness.link.unreliableChannel as unknown as FakeChannel).bufferedAmount = PEER_DIAGNOSTICS_BACKPRESSURE_BYTES;
    harness.diagnostics.update();

    expect(harness.diagnostics.getSnapshots()[0].backpressure).toBe(true);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    consoleWarn.mockRestore();
  });

  it('drops records of links that are gone', () => {
    const link = new FakeLink('peer-a', 'p1');
    let links: DiagnosableLink[] = [link];
    const diagnostics = new TransportDiagnostics({
      getLinks: () => links,
      getAppPingMs: () => 40,
    });

    diagnostics.update();
    expect(diagnostics.getSnapshots()[0].pingSampleCount).toBe(1);

    links = [];
    diagnostics.update();
    expect(diagnostics.getSnapshots()).toEqual([]);

    links = [link];
    diagnostics.update();
    expect(diagnostics.getSnapshots()[0].pingSampleCount).toBe(1);
  });

  it('picks the slowest link as the worst snapshot', () => {
    const fast = new FakeLink('peer-fast', 'p1');
    const slow = new FakeLink('peer-slow', 'p2');
    const pings: Record<string, number> = { p1: 12, p2: 90 };
    const diagnostics = new TransportDiagnostics({
      getLinks: () => [fast, slow],
      getAppPingMs: (playerId) => pings[playerId],
    });

    diagnostics.update();
    expect(diagnostics.getWorstSnapshot()?.playerId).toBe('p2');
  });
});
