import { describe, expect, it } from 'vitest';
import { evaluateProtocol, PROTOCOL_PATH } from '../scripts/check/protocol.mjs';

interface Case { target: number; head: number; base?: number; changed?: string[]; headTypes?: string; allow?: boolean }

const source = (version: number, types = 'export interface HelloMessage { t: "hello"; v: number }') =>
  `// Wire format.\n/** Compared in the handshake. */\nexport const PEER_PROTOCOL_VERSION = ${version};\n${types}\n`;

function evaluate({ target, head, base = target, changed = [], headTypes, allow = false }: Case) {
  return evaluateProtocol({
    targetLabel: 'main', mergeBase: 'merge-base', changed, allowUnbumpedWire: allow,
    read: (ref: string) => source(ref === 'target' ? target : base),
    readHead: (path: string) => (path === PROTOCOL_PATH ? source(head, headTypes) : null),
  });
}

describe('peer protocol guard', () => {
  it('passes a branch without wire changes that keeps the version', () => {
    expect(evaluate({ target: 36, head: 36, changed: ['src/ui/CenterHUD.ts'] }).ok).toBe(true);
  });

  it('requires a bump when a codec or the bootstrap slices change', () => {
    for (const path of ['src/network/bomberSquadronSnapshotCodec.ts', 'src/network/peer/PeerPacketCodec.ts',
      'src/network/FullGameStateBootstrap.ts']) {
      const result = evaluate({ target: 36, head: 36, changed: [path] });
      expect(result.ok, path).toBe(false);
      expect(result.errors[0]).toContain('37');
    }
  });

  it('accepts exactly one above the target and rejects skipped or stale numbers', () => {
    expect(evaluate({ target: 36, head: 37, base: 36, changed: ['src/network/enemySnapshotCodec.ts'] }).ok).toBe(true);
    expect(evaluate({ target: 36, head: 38, base: 36 }).ok).toBe(false);
    expect(evaluate({ target: 37, head: 36, base: 35 }).ok).toBe(false);
  });

  it('catches two branches that raised the version to the same number', () => {
    // The branch raised 35 → 36 for its own codec change, main meanwhile raised 35 → 36 for another one.
    const result = evaluate({ target: 36, head: 36, base: 35, changed: [PROTOCOL_PATH, 'src/network/krakenSnapshotCodec.ts'] });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('37');
  });

  it('treats a changed message type in protocol.ts as a wire change, but not a comment', () => {
    expect(evaluate({ target: 36, head: 36, changed: [PROTOCOL_PATH],
      headTypes: 'export interface HelloMessage { t: "hello"; v: number; z?: 1 }' }).ok).toBe(false);
    expect(evaluate({ target: 36, head: 36, changed: [PROTOCOL_PATH] }).ok).toBe(true);
  });

  it('only warns for other network files and honours the explicit override', () => {
    const maybe = evaluate({ target: 36, head: 36, changed: ['src/network/NetworkBridge.ts'] });
    expect(maybe.ok).toBe(true);
    expect(maybe.notes[0]).toContain('37');
    expect(evaluate({ target: 36, head: 36, changed: ['src/network/playerStateCodec.ts'], allow: true }).ok).toBe(true);
  });
});
