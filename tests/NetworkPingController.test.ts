import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkPingController } from '../src/network/NetworkPingController';
import { FakeNetwork, addClientRoom, createHostRoom, dropConnection, type TestRoom } from './fakePeerNetwork';

const rooms: TestRoom[] = [];
afterEach(() => { for (const room of rooms.splice(0).reverse()) room.room.leave(); vi.restoreAllMocks(); });
function controller({ room, transport }: TestRoom): NetworkPingController {
  return new NetworkPingController({ isHost: () => transport.isHost,
    getLocalPlayerId: () => room.getLocalPlayerId(),
    getLocalPlayer: () => room.getPlayerHandle(room.getLocalPlayerId())!,
    getPlayers: () => room.getPlayerIds().map(id => room.getPlayerHandle(id)!),
  });
}

describe('application ping across room resume', () => {
  it('ignores inherited acknowledgements and synchronizes the first probe after a browser reload', async () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const network = new FakeNetwork();
    const host = await createHostRoom(network), first = await addClientRoom(network, [], 'reload-ping-token');
    rooms.push(host, first);
    const hostPing = controller(host), firstPing = controller(first);
    for (let i = 0; i < 4; i++) {
      now += 1_000; firstPing.sendPingToHost(); first.room.update();
      now += 20; hostPing.update(); host.room.update();
      now += 20; firstPing.update();
    }
    expect(firstPing.getAppPingMs()).toBe(40);
    first.transport.destroy(); // Browser unload: the old client cannot reconnect itself.
    dropConnection(first);
    now += 100;
    const reloaded = await addClientRoom(network, [], 'reload-ping-token'); rooms.push(reloaded);
    expect(reloaded.room.getLocalPlayerId()).toBe(first.room.getLocalPlayerId());
    const reloadedPing = controller(reloaded);
    reloadedPing.update();
    expect.soft(reloadedPing.getAppPingMs()).toBeNull();
    now += 100; reloadedPing.sendPingToHost(); reloaded.room.update();
    now += 20; hostPing.update(); host.room.update();
    now += 20; reloadedPing.update();
    expect(reloadedPing.getAppPingMs()).toBe(40);
    expect(reloadedPing.getSynchronizedNow()).toBe(now);
  });

  it('accepts a delayed outstanding probe and ignores unrequested, replayed and reordered acknowledgements', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const state = new Map<string, unknown>();
    const player = { id: 'p1', getState: (key: string) => state.get(key),
      setState: (key: string, value: unknown) => { state.set(key, value); } };
    const ping = new NetworkPingController({ isHost: () => false, getLocalPlayerId: () => player.id,
      getLocalPlayer: () => player, getPlayers: () => [player] });
    ping.sendPingToHost();
    const first = state.get('fpp') as { seq: number; ts: number };
    now = 1_020; ping.sendPingToHost();
    const second = state.get('fpp') as typeof first;
    const acknowledge = (probe: typeof first, hostTs: number) => { state.set('fpa', { ...probe, hostTs }); ping.update(); };
    now = 1_040;
    acknowledge({ ...second, seq: second.seq + 1 }, 1_020);
    acknowledge({ ...first, ts: first.ts - 1 }, 1_020);
    expect(ping.getAppPingMs()).toBeNull();
    acknowledge(first, 1_020);
    expect(ping.getAppPingMs()).toBe(40);
    expect(ping.getSynchronizedNow()).toBe(now);
    now = 1_050; acknowledge(second, 1_035);
    expect(ping.getAppPingMs()).toBe(30);
    now = 1_100; acknowledge(first, 10_000); acknowledge(second, 10_000);
    expect(ping.getAppPingMs()).toBe(30);
    expect(ping.getSynchronizedNow()).toBe(now);
  });

  it('retires abandoned probes while a new probe can still synchronize after a long outage', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const state = new Map<string, unknown>();
    const player = { id: 'p1', getState: (key: string) => state.get(key),
      setState: (key: string, value: unknown) => { state.set(key, value); } };
    const ping = new NetworkPingController({ isHost: () => false, getLocalPlayerId: () => player.id,
      getLocalPlayer: () => player, getPlayers: () => [player] });
    ping.sendPingToHost();
    const abandoned = state.get('fpp') as { seq: number; ts: number };
    for (let i = 0; i < 1_000; i++) { now += 1_000; ping.sendPingToHost(); }
    state.set('fpa', { ...abandoned, hostTs: abandoned.ts + 20 }); ping.update();
    expect(ping.getAppPingMs()).toBeNull();
    const current = state.get('fpp') as typeof abandoned;
    now += 40; state.set('fpa', { ...current, hostTs: current.ts + 20 }); ping.update();
    expect(ping.getAppPingMs()).toBe(40);
    expect(ping.getSynchronizedNow()).toBe(now);
  });
});
