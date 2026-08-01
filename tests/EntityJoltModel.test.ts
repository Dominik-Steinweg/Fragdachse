import { describe, expect, it } from 'vitest';
import { HIT_FEEDBACK_VFX } from '../src/config';
import {
  type JoltState,
  joltEnvelope,
  resolveJoltPx,
  stepJolt,
  superposeJolt,
} from '../src/effects/entityJoltModel';
import { EntityJoltRegistry, type JoltTarget } from '../src/effects/EntityJoltRegistry';

/** Minimaler Ereignis-Emitter in der Form, die die Registry von `game.events` erwartet. */
function makeFakeGame() {
  const listeners = new Map<string, Array<() => void>>();
  const events = {
    on(event: string, listener: () => void) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
      return events;
    },
    off(event: string, listener: () => void) {
      const bucket = listeners.get(event) ?? [];
      const index = bucket.indexOf(listener);
      if (index >= 0) bucket.splice(index, 1);
      return events;
    },
  };
  return {
    game: { events } as never,
    emit(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
    listenerCount(event: string) {
      return (listeners.get(event) ?? []).length;
    },
  };
}

describe('joltEnvelope', () => {
  it('beginnt und endet exakt bei null', () => {
    expect(joltEnvelope(0)).toBe(0);
    expect(joltEnvelope(1)).toBe(0);
    expect(joltEnvelope(1.5)).toBe(0);
  });

  it('erreicht den vollen Ausschlag am Ende des Anstiegs', () => {
    expect(joltEnvelope(0.3)).toBeCloseTo(1, 6);
  });

  it('laeuft danach monoton zurueck, ohne ueberzuschwingen', () => {
    let previous = 1;
    for (let t = 0.3; t <= 1; t += 0.05) {
      const value = joltEnvelope(t);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      expect(value).toBeGreaterThanOrEqual(0);
      previous = value;
    }
  });
});

describe('resolveJoltPx', () => {
  /** `knockbackFactor` ist die inverse Gewichtsangabe: leichte Ziele zucken staerker. */
  it('skaliert mit dem Rueckstossfaktor des Ziels', () => {
    const light = resolveJoltPx(3, 1.9);
    const heavy = resolveJoltPx(3, 0.1);
    expect(light).toBeGreaterThan(heavy);
    expect(heavy).toBeGreaterThan(0);
  });

  it('deckelt den Ausschlag global', () => {
    expect(resolveJoltPx(100, 1.9)).toBe(HIT_FEEDBACK_VFX.maxJoltPx);
  });

  it('liefert null bei unbrauchbaren Eingaben', () => {
    expect(resolveJoltPx(0, 1)).toBe(0);
    expect(resolveJoltPx(Number.NaN, 1)).toBe(0);
    expect(resolveJoltPx(3, 0)).toBe(0);
  });

  it('daempft den lokalen Spieler ueber den Skalierungsfaktor', () => {
    const remote = resolveJoltPx(3, 1);
    const local = resolveJoltPx(3, 1, HIT_FEEDBACK_VFX.localPlayerJoltFactor);
    expect(local).toBeLessThan(remote);
  });
});

describe('superposeJolt', () => {
  it('ueberlagert einen zweiten Impuls, ohne den Deckel zu ueberschreiten', () => {
    let state: JoltState | null = null;
    for (let i = 0; i < 20; i += 1) {
      state = superposeJolt(state, 1, 0, 4, 120);
    }
    expect(state).not.toBeNull();
    expect(state!.peakPx).toBeLessThanOrEqual(HIT_FEEDBACK_VFX.maxJoltPx);
  });

  it('verrechnet gegenlaeufige Impulse, statt sie zu addieren', () => {
    // Erst auf den vollen Ausschlag laufen lassen – zum Startzeitpunkt ist die Huellkurve null,
    // dann gaebe es noch nichts zu verrechnen.
    const first = superposeJolt(null, 1, 0, 4, 120)!;
    stepJolt(first, 36);

    const partially = superposeJolt(first, -1, 0, 1.5, 120)!;
    expect(partially.peakPx).toBeCloseTo(2.5, 6);
    expect(partially.dirX).toBeCloseTo(1, 6);

    const second = superposeJolt(null, 1, 0, 4, 120)!;
    stepJolt(second, 36);
    expect(superposeJolt(second, -1, 0, 4, 120)).toBeNull();
  });

  it('ignoriert Impulse ohne Betrag oder Dauer', () => {
    expect(superposeJolt(null, 1, 0, 0, 120)).toBeNull();
    expect(superposeJolt(null, 1, 0, 4, 0)).toBeNull();
  });
});

describe('stepJolt', () => {
  it('klingt auf exakt null ab und meldet sich als beendet', () => {
    const state: JoltState = { dirX: 1, dirY: 0, peakPx: 4, elapsedMs: 0, durationMs: 120 };
    const finished = stepJolt(state, 200);
    expect(finished.finished).toBe(true);
    expect(finished.x).toBe(0);
    expect(finished.y).toBe(0);
  });

  /**
   * Schnellfeuerwaffen und Schaden ueber Zeit erzeugen viele kleine Treffer. Der Ausschlag
   * darf dabei niemals ueber den Deckel wachsen.
   */
  it('bleibt bei 200 Schadensticks in zwei Sekunden unter dem Deckel', () => {
    let state: JoltState | null = null;
    let maxOffset = 0;
    for (let tick = 0; tick < 200; tick += 1) {
      state = superposeJolt(state, 1, 0, resolveJoltPx(0.9, 1.5), 90);
      const offset = stepJolt(state!, 10);
      maxOffset = Math.max(maxOffset, Math.hypot(offset.x, offset.y));
      if (offset.finished) state = null;
    }
    expect(maxOffset).toBeLessThanOrEqual(HIT_FEEDBACK_VFX.maxJoltPx);
  });
});

describe('EntityJoltRegistry', () => {
  /**
   * Der eigentliche Vertrag: `sprite.x/y` ist beim Host die massgebliche Position fuer
   * Trefferabfragen. Der Versatz darf nur zwischen `prerender` und `postrender` existieren und
   * muss danach bitgleich zurueckgenommen sein.
   */
  it('gibt die Zielposition nach dem Renderfenster bitgleich zurueck', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target: JoltTarget = { x: 123.456, y: -78.9 };
    const originalX = target.x;
    const originalY = target.y;

    registry.jolt(target, 1, 0.5, 4, 120);
    registry.step(16);

    fake.emit('prerender');
    expect(target.x).not.toBe(originalX);

    fake.emit('postrender');
    expect(target.x).toBe(originalX);
    expect(target.y).toBe(originalY);

    registry.destroy();
  });

  it('traegt den Versatz auch bei ausgefallenem Renderdurchlauf nur einmal auf', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target: JoltTarget = { x: 10, y: 20 };

    registry.jolt(target, 1, 0, 4, 120);
    registry.step(16);
    fake.emit('prerender');
    const applied = target.x;
    fake.emit('prerender');
    expect(target.x).toBe(applied);

    fake.emit('postrender');
    fake.emit('postrender');
    expect(target.x).toBe(10);

    registry.destroy();
  });

  it('haelt waehrend scene.update keinen Versatz auf dem Ziel', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target: JoltTarget = { x: 50, y: 60 };

    registry.jolt(target, 1, 0, 4, 120);
    for (let frame = 0; frame < 8; frame += 1) {
      registry.step(16);
      expect(target.x).toBe(50);
      expect(target.y).toBe(60);
      fake.emit('prerender');
      fake.emit('postrender');
    }

    registry.destroy();
  });

  it('gibt den Versatz als Datum heraus, damit Effekte dem Koerper folgen koennen', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target: JoltTarget = { x: 0, y: 0 };

    expect(registry.getOffset(target)).toEqual({ x: 0, y: 0 });
    registry.jolt(target, 1, 0, 4, 120);
    registry.step(16);
    expect(registry.getOffset(target).x).toBeGreaterThan(0);

    registry.destroy();
  });

  it('laesst zerstoerte Ziele fallen', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target = { x: 0, y: 0, active: false } as JoltTarget;

    registry.jolt(target, 1, 0, 4, 120);
    registry.step(16);
    expect(registry.getOffset(target)).toEqual({ x: 0, y: 0 });

    registry.destroy();
  });

  it('setzt die Position bei reset() zurueck und meldet alle Listener ab', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target: JoltTarget = { x: 5, y: 5 };

    registry.jolt(target, 1, 0, 4, 120);
    registry.step(16);
    fake.emit('prerender');
    registry.reset();
    expect(target.x).toBe(5);
    expect(target.y).toBe(5);

    registry.destroy();
    expect(fake.listenerCount('prerender')).toBe(0);
    expect(fake.listenerCount('postrender')).toBe(0);
  });

  it('nimmt bei abgeschaltetem Impuls keine Anforderungen mehr an', () => {
    const fake = makeFakeGame();
    const registry = new EntityJoltRegistry(fake.game);
    const target: JoltTarget = { x: 0, y: 0 };

    registry.setEnabled(false);
    registry.jolt(target, 1, 0, 4, 120);
    registry.step(16);
    fake.emit('prerender');
    expect(target.x).toBe(0);

    registry.destroy();
  });
});
