import { describe, expect, it } from 'vitest';
import {
  PEER_PROTOCOL_VERSION,
  encodePeerMessage,
  parsePeerMessage,
  type PeerMessage,
} from '../src/network/peer/protocol';

function roundTrip(message: PeerMessage): PeerMessage | null {
  return parsePeerMessage(encodePeerMessage(message));
}

describe('peer protocol', () => {
  it('roundtrips every message type', () => {
    const messages: PeerMessage[] = [
      { t: 'hello', v: PEER_PROTOCOL_VERSION },
      {
        t: 'welcome',
        v: PEER_PROTOCOL_VERSION,
        id: 'p1',
        h: 'p0',
        roster: [{ id: 'p0' }, { id: 'p1' }],
        g: { gph: 'LOBBY' },
        p: { p0: { pnm: 'Host' } },
      },
      { t: 'join', id: 'p2', s: { pnm: 'Gast' } },
      { t: 'quit', id: 'p2' },
      { t: 'b', g: [['gs', { _s: 4 }]], p: [['p1', 'inp', { dx: 1 }]] },
      { t: 'rpc', c: 7, n: 'lu', d: { slot: 'weapon1' } },
      { t: 'rpc', c: 0, n: 'xfx', d: { x: 1 }, s: 'p0' },
      { t: 'res', c: 7, d: { ok: true } },
    ];

    for (const message of messages) {
      expect(roundTrip(message)).toEqual(message);
    }
  });

  it('rejects payloads that are not encoded messages', () => {
    expect(parsePeerMessage(undefined)).toBeNull();
    expect(parsePeerMessage(42)).toBeNull();
    expect(parsePeerMessage(new ArrayBuffer(4))).toBeNull();
    expect(parsePeerMessage('nicht json')).toBeNull();
    expect(parsePeerMessage('[1,2,3]')).toBeNull();
    expect(parsePeerMessage('{"t":42}')).toBeNull();
    expect(parsePeerMessage('{"t":"unbekannt"}')).toBeNull();
  });

  it('rejects structurally invalid messages instead of throwing', () => {
    expect(parsePeerMessage('{"t":"hello"}')).toBeNull();
    expect(parsePeerMessage('{"t":"welcome","v":1,"id":"","h":"p0","roster":[]}')).toBeNull();
    expect(parsePeerMessage('{"t":"welcome","v":1,"id":"p1","h":"p0"}')).toBeNull();
    expect(parsePeerMessage('{"t":"join"}')).toBeNull();
    expect(parsePeerMessage('{"t":"quit","id":""}')).toBeNull();
    expect(parsePeerMessage('{"t":"rpc","c":-1,"n":"lu"}')).toBeNull();
    expect(parsePeerMessage('{"t":"rpc","c":1,"n":""}')).toBeNull();
    expect(parsePeerMessage('{"t":"res","c":0}')).toBeNull();
  });

  it('drops malformed entries inside a batch and the batch when nothing survives', () => {
    const partial = parsePeerMessage('{"t":"b","g":[["ok",1],["bad"],[5,6]],"p":[["p1","inp",2],["p1"]]}');
    expect(partial).toEqual({ t: 'b', g: [['ok', 1]], p: [['p1', 'inp', 2]] });

    expect(parsePeerMessage('{"t":"b","g":[["bad"]]}')).toBeNull();
    expect(parsePeerMessage('{"t":"b"}')).toBeNull();
    expect(parsePeerMessage('{"t":"b","g":"keinArray"}')).toBeNull();
  });

  it('filters unusable roster entries but keeps the welcome message', () => {
    const message = parsePeerMessage(
      '{"t":"welcome","v":1,"id":"p1","h":"p0","roster":[{"id":"p0"},{},{"id":""}],"g":{},"p":{"p0":{"a":1},"p1":"kaputt"}}',
    );
    expect(message).toEqual({
      t: 'welcome',
      v: 1,
      id: 'p1',
      h: 'p0',
      roster: [{ id: 'p0' }],
      g: {},
      p: { p0: { a: 1 } },
    });
  });

  it('keeps the sender id only when it is a non-empty string', () => {
    expect(parsePeerMessage('{"t":"rpc","c":0,"n":"xfx","s":""}')).toEqual({ t: 'rpc', c: 0, n: 'xfx', d: undefined });
    expect(parsePeerMessage('{"t":"rpc","c":0,"n":"xfx","s":"p3"}')).toEqual({ t: 'rpc', c: 0, n: 'xfx', d: undefined, s: 'p3' });
  });
});
