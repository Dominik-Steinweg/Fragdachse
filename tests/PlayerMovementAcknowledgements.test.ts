import { describe, expect, it } from 'vitest';
import { PlayerMovementAcknowledgements } from '../src/systems/PlayerMovementAcknowledgements';

describe('host movement acknowledgement boundary', () => {
  it('publishes only consumed physics time belonging to the POST_UPDATE pose', () => {
    const acks = new PlayerMovementAcknowledgements();
    const pose = { x: 100, y: 100, positionRevision: 0 };
    acks.select('p', 0, 1, 100, true);
    expect(acks.snapshot('p', pose).canPredict).toBe(false);
    acks.consume('p', 0, 10);
    expect(acks.snapshot('p', pose).canPredict).toBe(false);
    pose.x += 1;
    acks.commit('p', pose);
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 1, appliedMs: 10, canPredict: true });

    // Scene.update selects the NEXT step; the proxy still represents the previous POST_UPDATE.
    acks.select('p', 0, 2, 100, true);
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 1, appliedMs: 10 });
    acks.consume('p', 0, 10);
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 1, appliedMs: 10 });
    pose.y += 1;
    acks.commit('p', pose);
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 2, appliedMs: 10 });

    // No physics step: publishing again neither acknowledges a selection nor adds render delta.
    acks.select('p', 0, 3, 100, true);
    acks.commit('p', pose);
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 2, appliedMs: 10 });
  });

  it('commits entity poses whose fields are prototype getters', () => {
    class EntityPose {
      private px = 3;
      get x(): number { return this.px; }
      get y(): number { return 4; }
      get positionRevision(): number { return 0; }
      move(): void { this.px++; }
    }
    const acks = new PlayerMovementAcknowledgements(), pose = new EntityPose();
    acks.select('p', 0, 1, 100, true); acks.consume('p', 0, 10); acks.commit('p', pose);
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 1, appliedMs: 10, canPredict: true });
    pose.move();
    expect(acks.snapshot('p', pose).canPredict).toBe(false);
  });

  it('counts blocked and held input once per step, independently of packets and render frames', () => {
    const acks = new PlayerMovementAcknowledgements();
    const pose = { x: 10, y: 20, positionRevision: 0 };
    acks.select('p', 0, 7, 100, true);
    for (let frame = 0; frame < 8; frame++) {
      acks.consume('p', 0, 5);
      acks.consume('p', 0, 5);
      acks.select('p', 0, 7, 100, true);
      acks.commit('p', pose);
    }
    expect(acks.snapshot('p', pose)).toMatchObject({ sequence: 7, appliedMs: 80, canPredict: true });
  });

  it('preserves interruptions between snapshots and invalidates hard resets immediately', () => {
    const acks = new PlayerMovementAcknowledgements();
    const pose = { x: 0, y: 0, positionRevision: 0 };
    acks.select('p', 0, 1, 100, true); acks.consume('p', 0, 10); acks.commit('p', pose);
    const original = acks.snapshot('p', pose);
    acks.interrupt('p');
    acks.select('p', 0, 1, 100, true);
    expect(acks.snapshot('p', pose).canPredict).toBe(false);
    acks.consume('p', 0, 5); acks.commit('p', pose);
    expect(acks.snapshot('p', pose).revision).toBeGreaterThan(original.revision);
    expect(acks.snapshot('p', pose).appliedMs).toBe(5);
    pose.positionRevision++; pose.x = 500;
    expect(acks.snapshot('p', pose).canPredict).toBe(false);
    acks.select('p', pose.positionRevision, 2, 100, true);
    acks.consume('p', pose.positionRevision, 5); acks.commit('p', pose);
    expect(acks.snapshot('p', pose)).toMatchObject({ canPredict: true, sequence: 2, appliedMs: 5 });
    acks.remove('p');
    expect(acks.snapshot('p', pose).canPredict).toBe(false);
  });
});
