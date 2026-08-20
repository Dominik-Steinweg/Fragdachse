import {
  assertFiveTargetScenarioConfig,
  DEFAULT_FIVE_TARGET_SCENARIO_CONFIG,
  type FiveTargetScenarioConfig,
} from './scenarioTypes';
import { createMulberry32Prng, type HeadlessTarget } from './HeadlessStaticTargetWorld';

export interface GenerateFiveTargetLayoutOptions {
  readonly scenarioConfig?: FiveTargetScenarioConfig;
  readonly seed: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertLayout(
  targets: readonly HeadlessTarget[],
  config: FiveTargetScenarioConfig,
): void {
  if (targets.length !== config.targetCount) {
    throw new Error('[WeaponBalanceLab] Five-Target-Layout muss exakt fuenf Ziele enthalten.');
  }

  const requiredCenterDistance = config.targetRadius * 2 + config.minimumTargetGap;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (target.id !== `target_${index + 1}`) {
      throw new Error('[WeaponBalanceLab] Five-Target-IDs muessen stabil target_1..target_5 sein.');
    }
    if (target.radius !== config.targetRadius) {
      throw new Error('[WeaponBalanceLab] Five-Target-Radius ist nicht szenariokanisch.');
    }
    if (
      target.x < config.layoutRegion.minX - 1e-9
      || target.x > config.layoutRegion.maxX + 1e-9
      || target.y < config.layoutRegion.minY - 1e-9
      || target.y > config.layoutRegion.maxY + 1e-9
    ) {
      throw new Error(`[WeaponBalanceLab] Ziel ${target.id} liegt ausserhalb der versionierten Testregion.`);
    }
    if (target.x <= 0) {
      throw new Error(`[WeaponBalanceLab] Ziel ${target.id} liegt nicht vor dem Spieler.`);
    }

    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const other = targets[otherIndex];
      const distance = Math.hypot(target.x - other.x, target.y - other.y);
      if (distance < requiredCenterDistance - 1e-9) {
        throw new Error(`[WeaponBalanceLab] Ziele ${other.id} und ${target.id} ueberlappen.`);
      }
    }
  }
}

function createTarget(index: number, x: number, y: number, radius: number): HeadlessTarget {
  return {
    id: `target_${index + 1}`,
    x,
    y,
    radius,
  };
}

/**
 * Erzeugt die fuenf kanonischen Dummy-Positionen aus Szenario-Version und Layout-Seed.
 * WeaponConfig, Upgrades und Weapon-RNG werden hier absichtlich nicht gelesen.
 */
export function generateFiveTargetLayout(
  options: GenerateFiveTargetLayoutOptions,
): readonly HeadlessTarget[] {
  const config = options.scenarioConfig ?? DEFAULT_FIVE_TARGET_SCENARIO_CONFIG;
  assertFiveTargetScenarioConfig(config);
  const random = createMulberry32Prng(options.seed);
  const targets: HeadlessTarget[] = [];

  if (config.layoutProfile === 'forward_cluster_v1') {
    // Seed-abhängig enger oder breiter, aber immer in derselben begrenzten Region.  Die
    // Offset-Formation hält den Mindestabstand bereits analytisch ein.
    const spacing = (config.targetRadius + config.minimumTargetGap / 2)
      * (1 + random() * 0.8);
    const centerX = clamp(
      (config.layoutRegion.minX + config.layoutRegion.maxX) * 0.5 + (random() - 0.5) * 10,
      config.layoutRegion.minX + 2 * spacing,
      config.layoutRegion.maxX - 2 * spacing,
    );
    const centerY = clamp(
      (random() - 0.5) * 48,
      config.layoutRegion.minY + spacing,
      config.layoutRegion.maxY - spacing,
    );
    const rowOffset = (random() - 0.5) * spacing * 0.35;
    const offsets: readonly [number, number][] = [
      [-1, -1],
      [1, -1],
      [-2, 1],
      [0, 1],
      [2, 1],
    ];

    for (let index = 0; index < offsets.length; index += 1) {
      const [offsetX, offsetY] = offsets[index];
      targets.push(createTarget(
        index,
        centerX + offsetX * spacing,
        centerY + offsetY * spacing + (index < 2 ? rowOffset : -rowOffset),
        config.targetRadius,
      ));
    }
  } else if (config.layoutProfile === 'melee_arc_v1') {
    // Ein leicht variierender, nicht ueberlappender Ring bleibt innerhalb des Bite-Arcs und
    // erzeugt je nach Phase unterschiedliche, aber weiterhin physikalisch sinnvolle Faecher.
    const ringRadius = 29 + random() * 1.5;
    const phase = -Math.PI / 2 + (random() - 0.5) * 0.12;
    const centerX = 34;
    for (let index = 0; index < config.targetCount; index += 1) {
      const angle = phase + index * (Math.PI * 2 / config.targetCount);
      targets.push(createTarget(
        index,
        centerX + Math.cos(angle) * ringRadius,
        Math.sin(angle) * ringRadius,
        config.targetRadius,
      ));
    }
  } else {
    const exhaustiveProfile: never = config.layoutProfile;
    throw new Error(`[WeaponBalanceLab] Unbekanntes Five-Target-Layout "${exhaustiveProfile}"`);
  }

  assertLayout(targets, config);
  return Object.freeze(targets);
}

