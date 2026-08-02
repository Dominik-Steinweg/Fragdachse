import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISTORTION_LIMITS,
  DISTORTION_PRIORITY,
  type DistortionSourceState,
  type DistortionViewRect,
  planDistortionFrame,
} from '../src/effects/distortion/distortionFramePlanner';

const VIEW: DistortionViewRect = { x: 0, y: 0, width: 1920, height: 1080 };
const MAP_SCALE = 0.25;

function source(overrides: Partial<DistortionSourceState> = {}): DistortionSourceState {
  return {
    id: 'a',
    profile: 'lens',
    worldX: 960,
    worldY: 540,
    radiusPx: 200,
    strength: 0.5,
    priority: DISTORTION_PRIORITY.timeBubble,
    ...overrides,
  };
}

describe('planDistortionFrame', () => {
  it('liefert ohne Quellen einen leeren Plan und schaltet den Pass ab', () => {
    const plan = planDistortionFrame([], VIEW, MAP_SCALE);
    expect(plan.commands).toEqual([]);
    expect(plan.amount).toBe(0);
  });

  it('rechnet Weltkoordinaten unabhaengig von Zoom und Renderaufloesung in Kartenpixel um', () => {
    const scrolled: DistortionViewRect = { x: 500, y: 100, width: 1920, height: 1080 };
    const [command] = planDistortionFrame([source({ worldX: 700, worldY: 300 })], scrolled, MAP_SCALE).commands;
    expect(command.mapX).toBeCloseTo((700 - 500) * MAP_SCALE, 6);
    expect(command.mapY).toBeCloseTo((300 - 100) * MAP_SCALE, 6);
    expect(command.sizePx).toBeCloseTo(200 * 2 * MAP_SCALE, 6);
  });

  it('verwirft Quellen ausserhalb des Bildes', () => {
    const plan = planDistortionFrame([source({ worldX: 5000 })], VIEW, MAP_SCALE);
    expect(plan.commands).toHaveLength(0);
    expect(plan.dropped).toBe(1);
  });

  /** Eine Quelle knapp neben dem Bild verzerrt dessen Rand noch – der Radius ist die Polsterung. */
  it('behaelt eine Quelle, die mit ihrem Radius ins Bild reicht', () => {
    const plan = planDistortionFrame([source({ worldX: -150, radiusPx: 300 })], VIEW, MAP_SCALE);
    expect(plan.commands).toHaveLength(1);
  });

  it('ignoriert Quellen ohne Staerke oder Radius', () => {
    expect(planDistortionFrame([source({ strength: 0 })], VIEW, MAP_SCALE).commands).toHaveLength(0);
    expect(planDistortionFrame([source({ radiusPx: 0 })], VIEW, MAP_SCALE).commands).toHaveLength(0);
  });

  it('kuerzt auf die erlaubte Zahl gleichzeitiger Quellen', () => {
    const sources = Array.from({ length: 10 }, (_, i) => source({ id: `s${i}`, worldX: 100 + i * 40 }));
    const plan = planDistortionFrame(sources, VIEW, MAP_SCALE, { ...DEFAULT_DISTORTION_LIMITS, maxSources: 3 });
    expect(plan.commands).toHaveLength(3);
    expect(plan.dropped).toBe(7);
  });

  /** Nuke schlaegt Schwarzes Loch schlaegt Zeitblase schlaegt Druckwelle. */
  it('behaelt bei Ueberlauf die wichtigsten Quellen', () => {
    const sources = [
      source({ id: 'wave', priority: DISTORTION_PRIORITY.shockwave }),
      source({ id: 'bubble', priority: DISTORTION_PRIORITY.timeBubble }),
      source({ id: 'hole', priority: DISTORTION_PRIORITY.blackHole }),
      source({ id: 'nuke', priority: DISTORTION_PRIORITY.nuke }),
    ];
    const plan = planDistortionFrame(sources, VIEW, MAP_SCALE, { ...DEFAULT_DISTORTION_LIMITS, maxSources: 2 });
    expect(plan.commands).toHaveLength(2);
    // Zeichenreihenfolge ist aufsteigend nach Wichtigkeit – die Nuke stempelt zuletzt.
    expect(plan.commands[plan.commands.length - 1].profile).toBe('lens');
  });

  /**
   * Die wichtigste Quelle muss die Ueberlappung gewinnen, deshalb wird von schwach nach stark
   * gezeichnet.
   */
  it('zeichnet die wichtigste Quelle zuletzt', () => {
    const sources = [
      source({ id: 'nuke', profile: 'ring', priority: DISTORTION_PRIORITY.nuke }),
      source({ id: 'bubble', profile: 'lens', priority: DISTORTION_PRIORITY.timeBubble }),
    ];
    const plan = planDistortionFrame(sources, VIEW, MAP_SCALE);
    expect(plan.commands[0].profile).toBe('lens');
    expect(plan.commands[1].profile).toBe('ring');
  });

  it('bevorzugt bei gleicher Prioritaet die bildmittigere Quelle', () => {
    const sources = [
      source({ id: 'far', worldX: 100, worldY: 100 }),
      source({ id: 'near', worldX: 960, worldY: 540, profile: 'ring' }),
    ];
    const plan = planDistortionFrame(sources, VIEW, MAP_SCALE, { ...DEFAULT_DISTORTION_LIMITS, maxSources: 1 });
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].profile).toBe('ring');
  });

  /** Einzelne Quellen wegzulassen erzeugte einen sichtbaren Sprung – ein gemeinsamer Faktor nicht. */
  it('regelt bei Ueberlast alle Quellen gleichmaessig herunter statt einzelne zu streichen', () => {
    const sources = Array.from({ length: 4 }, (_, i) => source({ id: `s${i}`, strength: 1 }));
    const plan = planDistortionFrame(sources, VIEW, MAP_SCALE, {
      ...DEFAULT_DISTORTION_LIMITS,
      maxSources: 4,
      maxTotalStrength: 2,
    });
    expect(plan.commands).toHaveLength(4);
    for (const command of plan.commands) expect(command.alpha).toBeCloseTo(0.5, 6);
  });

  /**
   * Der globale Faktor darf **nicht** mit der Gesamtstaerke wachsen: die Staerke jeder Quelle
   * steckt bereits in ihrem Alpha. Beides zu multiplizieren wuerde sie quadrieren.
   */
  it('haelt den Displacement-Faktor unabhaengig von der Zahl der Quellen', () => {
    const single = planDistortionFrame([source({ strength: 0.2 })], VIEW, MAP_SCALE);
    const many = planDistortionFrame(
      Array.from({ length: 4 }, (_, i) => source({ id: `s${i}`, strength: 1 })),
      VIEW,
      MAP_SCALE,
    );
    expect(single.amount).toBe(many.amount);
    expect(single.amount).toBe(DEFAULT_DISTORTION_LIMITS.maxAmount);
    expect(single.commands[0].alpha).toBeCloseTo(0.2, 6);
  });

  it('schaltet bei abgeschalteter Verzerrung vollstaendig ab', () => {
    expect(planDistortionFrame([source()], VIEW, 0).amount).toBe(0);
    expect(planDistortionFrame([source()], VIEW, MAP_SCALE, {
      ...DEFAULT_DISTORTION_LIMITS,
      maxSources: 0,
    }).commands).toHaveLength(0);
  });
});
