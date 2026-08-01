import { describe, expect, it } from 'vitest';
import {
  CAMERA_FEEDBACK_LIMITS,
  CameraFeedbackModel,
  feedbackAttenuation,
  feedbackEnvelope,
} from '../src/effects/camera/CameraFeedbackModel';

/** Feste Rauschphase: der Modellzustand soll allein von den Anforderungen abhängen. */
function makeModel(): CameraFeedbackModel {
  return new CameraFeedbackModel(CAMERA_FEEDBACK_LIMITS, () => 0.5);
}

function magnitude(output: { offsetX: number; offsetY: number }): number {
  return Math.hypot(output.offsetX, output.offsetY);
}

describe('feedbackEnvelope', () => {
  it('erreicht bei Ablauf exakt null', () => {
    for (const decay of ['linear', 'expo', 'impulse'] as const) {
      expect(feedbackEnvelope(decay, 1, 500)).toBe(0);
      expect(feedbackEnvelope(decay, 1.5, 500)).toBe(0);
    }
  });

  it('faellt ueber die Laufzeit monoton ab', () => {
    for (const decay of ['linear', 'expo'] as const) {
      let previous = feedbackEnvelope(decay, 0, 500);
      for (let t = 0.05; t <= 1; t += 0.05) {
        const current = feedbackEnvelope(decay, t, 500);
        expect(current).toBeLessThanOrEqual(previous + 1e-9);
        previous = current;
      }
    }
  });

  it('impulse steigt erst kurz an und faellt dann ab', () => {
    const attack = feedbackEnvelope('impulse', 0.002, 500);
    const peak = feedbackEnvelope('impulse', 0.02, 500);
    const late = feedbackEnvelope('impulse', 0.6, 500);
    expect(attack).toBeLessThan(peak);
    expect(late).toBeLessThan(peak);
  });
});

describe('feedbackAttenuation', () => {
  it('faellt am Rand des Wirkradius auf null', () => {
    expect(feedbackAttenuation(0, 900)).toBe(1);
    expect(feedbackAttenuation(900, 900)).toBe(0);
    expect(feedbackAttenuation(2000, 900)).toBe(0);
  });

  it('daempft mit wachsender Entfernung', () => {
    expect(feedbackAttenuation(600, 900)).toBeLessThan(feedbackAttenuation(300, 900));
  });
});

describe('CameraFeedbackModel', () => {
  it('aktualisiert eine Dauerquelle statt sie zu stapeln', () => {
    const model = makeModel();
    for (let frame = 0; frame < 120; frame += 1) {
      model.request(
        { id: 'airstrike:1', channel: 'rumble', amplitudePx: 4, durationMs: 400, priority: 85 },
        frame * 16,
      );
      model.step(16, frame * 16, 0, 0, 1);
    }
    expect(model.getDebugSnapshot()).toHaveLength(1);
  });

  /**
   * Regressionstest fuer den eigentlichen Grund des Umbaus: Phasers `Shake.start()` bricht ab,
   * solange ein Shake laeuft. Ein dauerhaft angefordertes schwaches Rumpeln (BFG im Flug)
   * blockierte damit die starke Detonation vollstaendig.
   */
  it('laesst ein schwaches Dauerrumpeln einen starken Einschlag nicht unterdruecken', () => {
    const rumbleOnly = makeModel();
    rumbleOnly.request({ id: 'bfg:flight', channel: 'rumble', amplitudePx: 6, durationMs: 260, priority: 30 }, 0);
    const rumbleMagnitude = magnitude(rumbleOnly.step(16, 16, 0, 0, 1));

    const combined = makeModel();
    combined.request({ id: 'bfg:flight', channel: 'rumble', amplitudePx: 6, durationMs: 260, priority: 30 }, 0);
    combined.step(16, 16, 0, 0, 1);
    combined.request({ channel: 'impact', amplitudePx: 38, durationMs: 550, priority: 100, decay: 'impulse' }, 16);

    let peak = 0;
    for (let frame = 2; frame < 12; frame += 1) {
      peak = Math.max(peak, magnitude(combined.step(16, frame * 16, 0, 0, 1)));
    }
    expect(peak).toBeGreaterThan(rumbleMagnitude * 4);
  });

  it('gewichtet Rumpeln nach Prioritaet', () => {
    const low = makeModel();
    low.request({ channel: 'rumble', amplitudePx: 20, durationMs: 400, priority: 10 }, 0);
    low.request({ channel: 'rumble', amplitudePx: 20, durationMs: 400, priority: 100 }, 0);
    const withHighPriorityPeer = magnitude(low.step(16, 16, 0, 0, 1));

    const alone = makeModel();
    alone.request({ channel: 'rumble', amplitudePx: 20, durationMs: 400, priority: 10 }, 0);
    alone.request({ channel: 'rumble', amplitudePx: 20, durationMs: 400, priority: 10 }, 0);
    const equalPeers = magnitude(alone.step(16, 16, 0, 0, 1));

    // Bei gleicher Prioritaet tragen beide voll bei, sonst wird die schwache Quelle abgewertet.
    expect(withHighPriorityPeer).toBeLessThan(equalPeers);
  });

  it('klingt vollstaendig auf null ab und gibt die Quelle frei', () => {
    const model = makeModel();
    model.request({ channel: 'impact', amplitudePx: 40, durationMs: 200, priority: 70 }, 0);
    const output = model.step(16, 250, 0, 0, 1);
    expect(output.offsetX).toBe(0);
    expect(output.offsetY).toBe(0);
    expect(output.activeSources).toBe(0);
  });

  it('begrenzt auch viele gleichzeitige Quellen weich', () => {
    const model = makeModel();
    for (let i = 0; i < 20; i += 1) {
      model.request({ channel: 'kick', amplitudePx: 400, durationMs: 500, priority: 50, dirX: 1, dirY: 0 }, 0);
    }
    const output = model.step(16, 16, 0, 0, 1);
    expect(magnitude(output)).toBeLessThanOrEqual(CAMERA_FEEDBACK_LIMITS.maxOffsetPx);
    expect(output.clamped).toBe(true);
  });

  it('verdraengt bei Ueberlauf die schwaechste Quelle', () => {
    const model = makeModel();
    for (let i = 0; i < CAMERA_FEEDBACK_LIMITS.maxSources; i += 1) {
      model.request({ channel: 'kick', amplitudePx: 30, durationMs: 500, priority: 90, dirX: 1, dirY: 0 }, 0);
    }
    model.request({ channel: 'kick', amplitudePx: 1, durationMs: 500, priority: 1, dirX: 1, dirY: 0 }, 0);

    const output = model.step(16, 16, 0, 0, 1);
    expect(output.activeSources).toBe(CAMERA_FEEDBACK_LIMITS.maxSources);
    expect(output.droppedSources).toBe(1);
    // Die starken Quellen haben ueberlebt, nicht die schwache.
    expect(model.getDebugSnapshot().every((source) => source.priority === 90)).toBe(true);
  });

  it('daempft eine entfernte Quelle vollstaendig weg', () => {
    const near = makeModel();
    near.request({ channel: 'impact', amplitudePx: 40, durationMs: 400, priority: 70, sourceX: 0, sourceY: 0, falloffPx: 900 }, 0);
    expect(magnitude(near.step(16, 16, 0, 0, 1))).toBeGreaterThan(0);

    const far = makeModel();
    far.request({ channel: 'impact', amplitudePx: 40, durationMs: 400, priority: 70, sourceX: 5000, sourceY: 0, falloffPx: 900 }, 0);
    expect(magnitude(far.step(16, 16, 0, 0, 1))).toBe(0);
  });

  // Gerichteter Kanal statt Rumpeln: die Rampe soll geprueft werden, nicht die Rauschkurve.
  it('rampt eine freigegebene Dauerquelle aus, statt sie abzureissen', () => {
    const model = makeModel();
    model.request(
      { id: 'nuke:1', channel: 'kick', amplitudePx: 20, durationMs: 4000, priority: 85, dirX: 1, dirY: 0, decay: 'linear' },
      0,
    );
    const before = magnitude(model.step(16, 16, 0, 0, 1));

    model.release('nuke:1', 16, 200);
    const midway = magnitude(model.step(16, 116, 0, 0, 1));
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(before);

    const after = model.step(16, 300, 0, 0, 1);
    expect(after.activeSources).toBe(0);
    expect(magnitude(after)).toBe(0);
  });

  it('entfernt auch ein freigegebenes Dauerrumpeln vollstaendig', () => {
    const model = makeModel();
    model.request({ id: 'nuke:1', channel: 'rumble', amplitudePx: 20, durationMs: 4000, priority: 85 }, 0);
    model.step(16, 16, 0, 0, 1);
    model.release('nuke:1', 16, 200);
    const after = model.step(16, 300, 0, 0, 1);
    expect(after.activeSources).toBe(0);
    expect(magnitude(after)).toBe(0);
  });

  it('skaliert alle Amplituden mit dem Bewegungsfaktor der Qualitaetsstufe', () => {
    const full = makeModel();
    full.request({ channel: 'kick', amplitudePx: 20, durationMs: 400, priority: 50, dirX: 1, dirY: 0 }, 0);
    const fullMagnitude = magnitude(full.step(16, 16, 0, 0, 1));

    const reduced = makeModel();
    reduced.request({ channel: 'kick', amplitudePx: 20, durationMs: 400, priority: 50, dirX: 1, dirY: 0 }, 0);
    const reducedMagnitude = magnitude(reduced.step(16, 16, 0, 0, 0.7));

    expect(reducedMagnitude).toBeLessThan(fullMagnitude);
    expect(reducedMagnitude).toBeGreaterThan(0);
  });

  it('haelt den Zoom neutral, solange keine Quelle die Prioritaetsschwelle erreicht', () => {
    const model = makeModel();
    model.request(
      { channel: 'zoom', amplitudePx: 0, zoomDelta: 0.01, durationMs: 400, priority: CAMERA_FEEDBACK_LIMITS.minPriorityForZoom - 1 },
      0,
    );
    expect(model.step(16, 16, 0, 0, 1).zoomScale).toBe(1);
  });

  it('begrenzt den Zoom-Puls nach oben', () => {
    const model = makeModel();
    for (let i = 0; i < 8; i += 1) {
      model.request({ channel: 'zoom', amplitudePx: 0, zoomDelta: 0.2, durationMs: 400, priority: 100 }, 0);
    }
    expect(model.step(16, 16, 0, 0, 1).zoomScale).toBeLessThanOrEqual(CAMERA_FEEDBACK_LIMITS.maxZoomScale);
  });

  it('liefert nach clear() einen neutralen Zustand', () => {
    const model = makeModel();
    model.request({ channel: 'impact', amplitudePx: 40, durationMs: 4000, priority: 70 }, 0);
    model.step(16, 16, 0, 0, 1);
    model.clear();
    const output = model.step(16, 32, 0, 0, 1);
    expect(output.activeSources).toBe(0);
    expect(magnitude(output)).toBe(0);
    expect(output.zoomScale).toBe(1);
  });
});
