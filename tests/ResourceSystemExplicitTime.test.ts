import { describe, expect, it } from 'vitest';
import {
  ADRENALINE_MAX,
  ADRENALINE_REGEN_PAUSE_MS,
  ADRENALINE_REGEN_PER_SEC,
} from '../src/config';
import { ResourceSystem } from '../src/systems/ResourceSystem';

describe('ResourceSystem – explizite Zeit und Regeneration', () => {
  it('setzt die Regen-Pause exakt auf nowMs + ADRENALINE_REGEN_PAUSE_MS beim Drain', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('p1');
    resources.setAdrenaline('p1', 50);

    const nowMs = 10_000;
    resources.drainAdrenaline('p1', 10, nowMs);

    expect(resources.getAdrenaline('p1')).toBe(40);
    expect(resources.getRegenPausedUntil('p1')).toBe(nowMs + ADRENALINE_REGEN_PAUSE_MS);
  });

  it('pausiert die Regeneration nicht, wenn Adrenalinspritze aktiv ist', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('p1');
    resources.setAdrenaline('p1', 50);
    resources.setPowerUpSystem({ getRegenMultiplier: () => 2.0 });

    const nowMs = 10_000;
    resources.drainAdrenaline('p1', 10, nowMs);

    expect(resources.getAdrenaline('p1')).toBe(40);
    // Pause bleibt 0
    expect(resources.getRegenPausedUntil('p1')).toBe(0);
  });

  it('blockiert regenTick waehrend der Pause und regeneriert erst nach Ablauf', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('p1');
    resources.setAdrenaline('p1', 50);

    const drainTime = 10_000;
    resources.drainAdrenaline('p1', 20, drainTime);
    expect(resources.getAdrenaline('p1')).toBe(30);

    // Frame waehrend der Pause: kein Regen
    resources.regenTick('p1', 100, drainTime + 250);
    expect(resources.getAdrenaline('p1')).toBe(30);

    // Genau am Pausen-Ende minus 1 ms: kein Regen
    const pauseEnd = drainTime + ADRENALINE_REGEN_PAUSE_MS;
    resources.regenTick('p1', 100, pauseEnd - 1);
    expect(resources.getAdrenaline('p1')).toBe(30);

    // Ab Pausen-Ende: regeneriert 1 Sekunde mit Standard-Rate
    resources.regenTick('p1', 1_000, pauseEnd);
    expect(resources.getAdrenaline('p1')).toBe(30 + ADRENALINE_REGEN_PER_SEC);
  });

  it('deckelt passive Regeneration auf das Maximum', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('p1');
    resources.setAdrenaline('p1', ADRENALINE_MAX - 1);

    resources.regenTick('p1', 5_000, 10_000);
    expect(resources.getAdrenaline('p1')).toBe(ADRENALINE_MAX);
  });

  it('beruecksichtigt benutzerdefinierte Regen-Raten und PowerUp-Multiplikatoren', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('p1');
    resources.setAdrenaline('p1', 20);
    resources.setAdrenalineRegenRateResolver(() => 10);
    resources.setPowerUpSystem({ getRegenMultiplier: () => 1.5 });

    // 1000 ms mit Rate 10 * 1.5 = 15 Adrenalin
    resources.regenTick('p1', 1_000, 10_000);
    expect(resources.getAdrenaline('p1')).toBe(35);
  });

  it('erhaelt den Revisionszaehler unberuehrt wenn kein Adrenalin regeneriert wird', () => {
    const resources = new ResourceSystem();
    resources.initPlayer('p1');
    resources.setAdrenaline('p1', ADRENALINE_MAX);
    const revBefore = resources.getAdrenalineRevision('p1');

    resources.regenTick('p1', 1_000, 10_000);
    expect(resources.getAdrenalineRevision('p1')).toBe(revBefore);
  });
});
