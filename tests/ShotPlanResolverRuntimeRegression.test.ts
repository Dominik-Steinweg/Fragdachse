import { describe, expect, it } from 'vitest';
import { resolveShotPlan, resolveTotalSpreadDeg, resolveEffectivePelletCount } from '../src/loadout/ShotPlanResolver';
import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';

describe('Runtime Characterization Tests: ShotPlanResolver & Spread Contracts', () => {
  describe('1. P90 Single Projectile Spread-Randomisierung', () => {
    it('erzeugt für Einzelschuss-Waffen genau 1 ShotItem mit korrektem Audio-Marker', () => {
      const p90 = WEAPON_CONFIGS.P90;
      const plan = resolveShotPlan({
        config: p90,
        aimAngle: Math.PI / 4,
        dynamicSpread: 0,
        isMoving: false,
        random: () => 0.5, // 0.5 * 2 - 1 = 0 (Zentrum)
      });

      expect(plan.pelletCount).toBe(1);
      expect(plan.shots.length).toBe(1);
      expect(plan.shots[0].angle).toBeCloseTo(Math.PI / 4, 5);
      expect(plan.shots[0].isMainAudioShot).toBe(true);
      expect(plan.shots[0].config.shotAudio).toBeDefined();
    });

    it('begrenzt den Random-Winkel exakt auf [-halfSpreadRad, +halfSpreadRad]', () => {
      const p90 = WEAPON_CONFIGS.P90;
      const dynamicSpread = 4;
      const totalSpreadDeg = p90.spreadStanding + dynamicSpread; // 2 + 4 = 6°
      const expectedHalfSpreadRad = (totalSpreadDeg * Math.PI / 180) / 2;

      // Random = 0 -> minimaler Winkel (-halfSpreadRad)
      const planMin = resolveShotPlan({
        config: p90,
        aimAngle: 0,
        dynamicSpread,
        random: () => 0,
      });
      expect(planMin.shots[0].angle).toBeCloseTo(-expectedHalfSpreadRad, 5);

      // Random = 1 -> maximaler Winkel (+halfSpreadRad)
      const planMax = resolveShotPlan({
        config: p90,
        aimAngle: 0,
        dynamicSpread,
        random: () => 1,
      });
      expect(planMax.shots[0].angle).toBeCloseTo(+expectedHalfSpreadRad, 5);
    });
  });

  describe('2. Multi-Pellet Fächerung & Audio-Verhalten', () => {
    it('erteilt nur dem ersten Pellet Audio und entfernt shotAudio bei Folgeschüssen', () => {
      const shotgun: WeaponConfig = {
        ...WEAPON_CONFIGS.P90,
        id: 'TEST_SHOTGUN',
        pelletCount: 3,
        pelletSpreadAngle: 10,
        shotAudio: { successKey: 'shot_p90' },
      };

      const plan = resolveShotPlan({
        config: shotgun,
        aimAngle: 0,
        dynamicSpread: 0,
        random: () => 0.5,
      });

      expect(plan.pelletCount).toBe(3);
      expect(plan.shots.length).toBe(3);

      // Erstes Pellet behält Audio
      expect(plan.shots[0].isMainAudioShot).toBe(true);
      expect(plan.shots[0].config.shotAudio).toEqual({ successKey: 'shot_p90' });

      // Folgeschüsse haben kein Audio
      expect(plan.shots[1].isMainAudioShot).toBe(false);
      expect(plan.shots[1].config.shotAudio).toBeUndefined();

      expect(plan.shots[2].isMainAudioShot).toBe(false);
      expect(plan.shots[2].config.shotAudio).toBeUndefined();
    });

    it('berechnet die effektive Pellet-Anzahl mit pelletCountMultiplier', () => {
      const weaponA: WeaponConfig = {
        ...WEAPON_CONFIGS.P90,
        id: 'TEST_MULT_GUN',
        pelletCount: 4,
        pelletCountMultiplier: 1.5,
      };

      expect(resolveEffectivePelletCount(weaponA)).toBe(6); // round(4 * 1.5) = 6
    });
  });

  describe('3. AK-47 fireControlSpreadMultiplier', () => {
    it('skaliert den Gesamtwinkel des Spreads exakt proportional', () => {
      const akConfig: WeaponConfig = {
        ...WEAPON_CONFIGS.P90,
        id: 'AK47_TEST',
        spreadStanding: 10,
      };

      // Unmodifiziert: 10°
      const baseSpread = resolveTotalSpreadDeg({
        config: akConfig,
        dynamicSpread: 0,
        fireControlSpreadMultiplier: 1.0,
      });
      expect(baseSpread).toBe(10);

      // Mit 0.6x Multiplikator: 6°
      const tightSpread = resolveTotalSpreadDeg({
        config: akConfig,
        dynamicSpread: 0,
        fireControlSpreadMultiplier: 0.6,
      });
      expect(tightSpread).toBeCloseTo(6.0, 5);
    });
  });

  describe('4. Scope-Interpolation', () => {
    it('interpoliert Spread linear von unscopedSpreadDeg (progress=0) zu fullyAimedSpread (progress=1)', () => {
      const scopedRifle: WeaponConfig = {
        ...WEAPON_CONFIGS.P90,
        id: 'SCOPED_RIFLE',
        spreadStanding: 1.0,
        spreadMoving: 10.0,
        scopeConfig: {
          scopeInMs: 1000,
          fullScopeViewRadius: 64,
          edgeSoftnessPx: 40,
          unscopedSpreadDeg: 30.0,
          unscopeSpeedMs: 250,
        },
      };

      // progress = 0 -> 30°
      expect(resolveTotalSpreadDeg({ config: scopedRifle, dynamicSpread: 0, scopeProgress: 0, isMoving: false })).toBe(30.0);

      // progress = 0.5 -> 30 + (1 - 30) * 0.5 = 15.5°
      expect(resolveTotalSpreadDeg({ config: scopedRifle, dynamicSpread: 0, scopeProgress: 0.5, isMoving: false })).toBe(15.5);

      // progress = 1.0 -> 1.0°
      expect(resolveTotalSpreadDeg({ config: scopedRifle, dynamicSpread: 0, scopeProgress: 1.0, isMoving: false })).toBe(1.0);
    });
  });
});
