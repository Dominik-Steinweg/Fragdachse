import { describe, expect, it } from 'vitest';

import { ParticleFlowScheduler } from '../src/effects/gpu/ParticleFlowScheduler';

describe('particle flow scheduler', () => {
  it('starts with the emitter frequency as its countdown', () => {
    // Bomb 80 ms, Spark 70 ms – wie die `frequency` im bisherigen Emitter-Config.
    const bomb = new ParticleFlowScheduler(80);
    expect(bomb.getCounter()).toBe(80);

    expect(bomb.tick(79)).toBe(0);
    expect(bomb.tick(1)).toBe(1);
  });

  it('adds the frequency valid at spawn time back onto the countdown', () => {
    const flow = new ParticleFlowScheduler(80);
    flow.tick(80);
    expect(flow.getCounter()).toBe(80);

    flow.setFrequency(20);
    flow.tick(80);
    // 80 - 80 = 0 -> ein Spawn, danach +20.
    expect(flow.getCounter()).toBe(20);
  });

  it('never resets the running countdown on a frequency change', () => {
    // Der Airstrike schreibt heute direkt auf `emitter.frequency`, weil `setFrequency()` den
    // Flow-Zaehler pro Frame zuruecksetzen und den Fluss damit ganz unterbinden wuerde.
    const flow = new ParticleFlowScheduler(120);
    flow.tick(100);
    expect(flow.getCounter()).toBe(20);

    flow.setFrequency(20);
    expect(flow.getCounter()).toBe(20);
    flow.setFrequency(115);
    expect(flow.getCounter()).toBe(20);

    // Selbst bei jedem Frame neu gesetzter Frequenz laeuft der Countdown weiter ab.
    expect(flow.tick(20)).toBe(1);
  });

  it('emits every due particle within one large delta', () => {
    const flow = new ParticleFlowScheduler(80);
    flow.setFrequency(20);
    // 80 Countdown, dann 20er-Schritte: 100 ms decken den Start plus einen weiteren Schritt.
    expect(flow.tick(100)).toBe(2);
    expect(flow.getCounter()).toBe(20);
  });

  it('keeps a fractional remainder instead of drifting', () => {
    const flow = new ParticleFlowScheduler(20);
    let total = 0;
    for (let frame = 0; frame < 100; frame += 1) total += flow.tick(16.6667);
    // 100 Frames a 16,6667 ms = 1666,67 ms; bei 20 ms Intervall sind 83 Spawns faellig.
    expect(total).toBe(83);
  });
});
