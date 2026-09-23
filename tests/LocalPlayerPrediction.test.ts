import { describe, expect, it, vi } from 'vitest';
import { LocalPlayerPrediction, LOCAL_MOVEMENT_PREDICTION, type LocalPredictionBody } from '../src/systems/LocalPlayerPrediction';
import type { PlayerInput, PlayerMovementPredictionState } from '../src/types';
import { PlayerMovementAcknowledgements } from '../src/systems/PlayerMovementAcknowledgements';

function fixture(stepMs = 1) {
  let input: PlayerInput = { dx: 1, dy: 0, aim: 0, movementSequence: 1, worldRevision: 5 };
  let x = 0, y = 0;
  const rendered = { x: 0, y: 0, walking: false, discontinuity: false };
  const body: LocalPredictionBody = {
    get x() { return x; }, get y() { return y; }, stepMs, control: vi.fn(),
    reset: (px, py) => { x = px; y = py; },
    step: (dx, dy, speed, ms) => {
      const length = Math.hypot(dx, dy);
      if (length) { x += dx / length * speed * ms / 1000; y += dy / length * speed * ms / 1000; }
    },
    canCorrectTo: vi.fn(() => true),
    present: (ox, oy, walking, discontinuity) => { Object.assign(rendered, { x: x + ox, y: y + oy, walking, discontinuity }); },
  };
  const restartInput = vi.fn((confirmed: number) => { input = { ...input, movementSequence: Math.max(input.movementSequence!, confirmed) + 1 }; });
  const prediction = new LocalPlayerPrediction(5, { getInput: () => input, restartInput });
  prediction.setBody(body);
  let state: PlayerMovementPredictionState = { sequence: 1, appliedMs: 0, revision: 0, canPredict: true, speed: 100 };
  let snapshot = { x: 0, y: 0, alive: true, positionRevision: 0, movementPrediction: state };
  let version = 0, now = 0;
  const frame = (ms = 0) => { now += ms; prediction.update(snapshot, version, ms, now, true); };
  const acknowledge = (px: number, py: number, patch: Partial<PlayerMovementPredictionState> = {}) => {
    state = { ...state, ...patch }; snapshot = { ...snapshot, x: px, y: py, movementPrediction: state }; version++;
  };
  frame();
  return { prediction, body, rendered, restartInput, frame, acknowledge,
    get input() { return input; }, get snapshot() { return snapshot; },
    move: (dx: number, dy: number) => { input = { ...input, dx, dy, movementSequence: input.movementSequence! + 1 }; },
    replaceSnapshot: (patch: Partial<typeof snapshot>) => { snapshot = { ...snapshot, ...patch }; version++; },
  };
}

describe('local WASD prediction', () => {
  it.each([0, 30, 100, 160])('converges with %s ms one-way latency, jitter, loss and reordered states', latency => {
    const f = fixture(1000 / 120), acks = new PlayerMovementAcknowledgements();
    const host = { x: 0, y: 0, positionRevision: 0 };
    let hostInput = { ...f.input, dx: 0, dy: 0 };
    let lastSentSequence = -1, inputVersion = 0, receivedInputVersion = -1, receivedSnapshotVersion = -1;
    const messages: { at: number; deliver(): void }[] = [];
    const queue = (tick: number, version: number, deliver: () => void) => {
      if (version % 7 === 4) return; // Supersedable packet loss; keepalive must recover the final stop.
      messages.push({ at: tick + Math.round(latency * 120 / 1000) + (version % 3 === 0 ? 9 : 0), deliver });
    };
    for (let tick = 0; tick < 480; tick++) {
      messages.sort((a, b) => a.at - b.at);
      while (messages[0]?.at <= tick) messages.shift()!.deliver();
      const length = Math.hypot(hostInput.dx, hostInput.dy);
      if (length) { host.x += hostInput.dx / length * 100 / 120; host.y += hostInput.dy / length * 100 / 120; }
      acks.select('p', 0, hostInput.movementSequence, 100, true);
      acks.consume('p', 0, 1000 / 120); acks.commit('p', host);
      if (tick % 6 === 0) {
        const version = tick, pose = { ...host }, state = acks.snapshot('p', host);
        queue(tick, tick / 6, () => {
          if (version <= receivedSnapshotVersion) return; // Same newest-state rule as PeerRoom.
          receivedSnapshotVersion = version; f.acknowledge(pose.x, pose.y, state);
        });
      }
      if (tick % 2 !== 0) continue;
      if (tick === 48) f.move(0, 1);
      if (tick === 96) f.move(-1, -1);
      if (tick === 144) f.move(0, 0);
      f.frame(1000 / 60);
      if (tick === 0) expect(f.body.x).toBeGreaterThan(0); // First local frame, before any host confirmation.
      if (tick >= 144) expect(f.prediction.isMoving).toBe(false);
      if (f.input.movementSequence !== lastSentSequence || tick % 12 === 0) {
        const input = { ...f.input }, version = ++inputVersion;
        lastSentSequence = input.movementSequence!;
        queue(tick, version, () => {
          if (version <= receivedInputVersion) return;
          receivedInputVersion = version; hostInput = input;
        });
      }
      expect(Number.isFinite(f.body.x + f.body.y)).toBe(true);
    }
    expect(hostInput.dx).toBe(0); expect(hostInput.dy).toBe(0);
    expect(f.body.x).toBeCloseTo(host.x, 6); expect(f.body.y).toBeCloseTo(host.y, 6);
    expect(f.rendered.x).toBeCloseTo(host.x, 3); expect(f.rendered.y).toBeCloseTo(host.y, 3);
  });

  it('starts, stops and turns immediately without waiting for a snapshot', () => {
    const f = fixture();
    f.frame(20); expect(f.body.x).toBeCloseTo(2); expect(f.prediction.isMoving).toBe(true);
    f.move(0, 0); f.frame(20); expect(f.body.x).toBeCloseTo(2); expect(f.prediction.isMoving).toBe(false);
    f.move(0, -1); f.frame(20); expect(f.body.y).toBeCloseTo(-2);
  });

  it.each([30, 60, 120, 144])('normalizes diagonals at %s render FPS', fps => {
    const f = fixture(1000 / 120); f.move(1, 1);
    for (let i = 0; i < Math.floor(fps / 5); i++) f.frame(1000 / fps);
    // The body stays on the fixed step grid; the presented pose includes the unfinished step.
    expect(f.rendered.x).toBeCloseTo(f.rendered.y);
    expect(Math.hypot(f.rendered.x, f.rendered.y)).toBeCloseTo(Math.floor(fps / 5) * 100 / fps);
  });

  it('replays only the unconsumed part of a held sequence, without double-counting repeated ACKs', () => {
    const f = fixture(); f.frame(20); f.frame(20);
    const seq = f.input.movementSequence!;
    const immutable = { ...f.snapshot };
    f.acknowledge(1, 0, { sequence: seq, appliedMs: 10 }); f.frame();
    expect(f.body.x).toBeCloseTo(4);
    f.frame(); expect(f.body.x).toBeCloseTo(4);
    f.acknowledge(2.5, 0, { appliedMs: 25 }); f.frame();
    expect(f.body.x).toBeCloseTo(4);
    f.acknowledge(4, 0, { appliedMs: 40 }); f.frame();
    expect(f.body.x).toBeCloseTo(4);
    expect(immutable.x).toBe(0); expect(immutable.movementPrediction.appliedMs).toBe(0);
  });

  it('discards skipped input states and keeps a correction out of the logical body', () => {
    const f = fixture(); f.frame(20); f.move(0, 1); f.frame(20);
    f.acknowledge(0, 1, { sequence: f.input.movementSequence, appliedMs: 10 }); f.frame();
    expect(f.body.x).toBe(0); expect(f.body.y).toBeCloseTo(2);
    expect(f.rendered.x).toBeCloseTo(2);
    f.move(0, 0); f.frame(20);
    expect(f.body.x).toBe(0); expect(f.rendered.x).toBeGreaterThan(0); expect(f.rendered.x).toBeLessThan(2);
    expect(f.prediction.isMoving).toBe(false);
  });

  it('snaps corrections that would cross an obstacle', () => {
    const f = fixture(); f.frame(20);
    vi.mocked(f.body.canCorrectTo).mockReturnValue(false);
    f.acknowledge(0, 0, { sequence: f.input.movementSequence, appliedMs: 20 }); f.frame();
    expect(f.body.x).toBe(0); expect(f.rendered.x).toBe(0); expect(f.rendered.discontinuity).toBe(true);
  });

  it('snaps large errors and never carries history into another entity, participation or World', () => {
    const f = fixture(); f.frame(20);
    f.acknowledge(1000, 0, { sequence: f.input.movementSequence, appliedMs: 20 }); f.frame();
    expect(f.rendered.x).toBe(1000); expect(f.rendered.discontinuity).toBe(true);
    f.frame(20);
    f.prediction.update(f.snapshot, 10, 0, 40, false);
    expect(f.prediction.ownsPosition).toBe(false);
    f.acknowledge(30, 10); f.frame(); expect(f.body.x).toBe(30);
    f.frame(20);
    const next = fixture(); f.prediction.setBody(next.body);
    f.frame(); expect([next.body.x, next.body.y]).toEqual([30, 10]);
    const nextWorld = new LocalPlayerPrediction(6, { getInput: () => f.input, restartInput: vi.fn() });
    nextWorld.setBody(f.body); nextWorld.update(f.snapshot, 1, 10, 10, true);
    expect(nextWorld.ownsPosition).toBe(false);
    f.prediction.destroy(); nextWorld.destroy();
  });

  it('holds during snapshot loss and reinitializes from a fresh baseline', () => {
    const f = fixture();
    for (let elapsed = 0; elapsed <= LOCAL_MOVEMENT_PREDICTION.maxSnapshotAgeMs; elapsed += 25) f.frame(25);
    const held = f.body.x;
    f.frame(25); expect(f.body.x).toBe(held); expect(f.prediction.isMoving).toBe(false);
    f.acknowledge(10, 20, { sequence: f.input.movementSequence, appliedMs: 200 }); f.frame();
    expect([f.body.x, f.body.y]).toEqual([10, 20]);
    f.frame(10); expect(f.body.x).toBeCloseTo(11);
  });

  it('bounds pending history even if fresh snapshots never acknowledge it', () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) { f.acknowledge(0, 0); f.frame(25); }
    expect(f.body.x).toBeLessThanOrEqual(LOCAL_MOVEMENT_PREDICTION.maxHistoryMs * 100 / 1000);
    f.frame(10); expect(Number.isFinite(f.body.x)).toBe(true);
  });

  it('resets across special movement, teleports, death and reconnect without replaying the old path', () => {
    const f = fixture(); f.frame(30);
    f.acknowledge(50, 0, { canPredict: false, revision: 1 }); f.frame();
    expect(f.prediction.ownsPosition).toBe(false); expect(f.body.control).toHaveBeenLastCalledWith(false);
    f.acknowledge(80, 10, { canPredict: true, revision: 2 }); f.frame();
    expect([f.body.x, f.body.y]).toEqual([80, 10]);
    f.replaceSnapshot({ x: 300, positionRevision: 1 }); f.frame();
    expect(f.body.x).toBe(300);
    f.replaceSnapshot({ alive: false }); f.frame(); expect(f.prediction.ownsPosition).toBe(false);
    f.replaceSnapshot({ alive: true, x: 25, positionRevision: 2 }); f.frame(); expect(f.body.x).toBe(25);
    f.prediction.reset(); f.frame(10); expect(f.prediction.ownsPosition).toBe(false);
    f.acknowledge(30, 10); f.frame(); expect(f.body.x).toBe(30);
    f.prediction.destroy(); f.frame(10); expect(f.prediction.ownsPosition).toBe(false);
  });

  it('glides across a host interruption but snaps a teleport', () => {
    const f = fixture(); f.frame(50); f.frame(50);
    const visual = f.rendered.x;
    f.acknowledge(4, 0, { revision: 1, sequence: f.input.movementSequence, appliedMs: 40 }); f.frame();
    expect(f.body.x).toBe(4); expect(f.rendered.x).toBeCloseTo(visual);
    f.frame(20); expect(f.rendered.x).toBeLessThan(visual + 2); expect(f.rendered.x).toBeGreaterThan(6);
    f.replaceSnapshot({ x: 40, positionRevision: 1 }); f.frame();
    expect(f.rendered.x).toBe(40); expect(f.rendered.discontinuity).toBe(true);
  });

  it('uses new host speed for future input and clamps a stalled render frame', () => {
    const f = fixture();
    f.acknowledge(0, 0, { speed: 50 }); f.frame(1000);
    // A fresh baseline after a tab stall still cannot turn render delta into a large jump.
    expect(f.body.x).toBeLessThanOrEqual(50 * LOCAL_MOVEMENT_PREDICTION.maxFrameMs / 1000);
    f.acknowledge(0, 0, { speed: 50, sequence: f.input.movementSequence,
      appliedMs: LOCAL_MOVEMENT_PREDICTION.maxFrameMs }); f.frame(20);
    expect(f.body.x).toBeCloseTo(1);
  });
});
