import { ADRENALINE_MAX, HP_MAX, RAGE_MAX } from '../config';
import type { ArenaHUDData } from './ArenaHUD';

export interface LocalArenaHudData extends ArenaHUDData {
  weapon2AdrenalineCost: number;
}

interface BuildLocalArenaHudDataParams {
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  adrenaline: number;
  maxAdrenaline: number;
  rage: number;
  maxRage: number;
  isUltimateActive: boolean;
  ultimateRequiredRage: number;
  ultimateThresholds: number[];
  ultimateDisplayName?: string;
  weapon1CooldownFrac: number;
  weapon2CooldownFrac: number;
  utilityCooldownFrac: number;
  utilityDisplayName?: string;
  adrenalineSyringeActive?: boolean;
  isUtilityOverridden?: boolean;
  activePowerUps?: ArenaHUDData['activePowerUps'];
  shieldBuff?: ArenaHUDData['shieldBuff'];
  weapon2AdrenalineCost?: number;
}

interface BuildInitialLocalArenaHudDataParams {
  maxArmor?: number;
  maxAdrenaline?: number;
  maxRage?: number;
  ultimateRequiredRage: number;
  ultimateThresholds: number[];
  ultimateDisplayName?: string;
  utilityDisplayName?: string;
  weapon2AdrenalineCost?: number;
}

export function buildLocalArenaHudData(params: BuildLocalArenaHudDataParams): LocalArenaHudData {
  return {
    hp: params.hp,
    maxHp: params.maxHp,
    armor: params.armor,
    maxArmor: params.maxArmor,
    adrenaline: params.adrenaline,
    maxAdrenaline: params.maxAdrenaline,
    rage: params.rage,
    maxRage: params.maxRage,
    isUltimateActive: params.isUltimateActive,
    ultimateRequiredRage: params.ultimateRequiredRage,
    ultimateThresholds: params.ultimateThresholds,
    ultimateDisplayName: params.ultimateDisplayName,
    weapon1CooldownFrac: params.weapon1CooldownFrac,
    weapon2CooldownFrac: params.weapon2CooldownFrac,
    utilityCooldownFrac: params.utilityCooldownFrac,
    utilityDisplayName: params.utilityDisplayName,
    adrenalineSyringeActive: params.adrenalineSyringeActive ?? false,
    isUtilityOverridden: params.isUtilityOverridden ?? false,
    activePowerUps: params.activePowerUps ?? [],
    shieldBuff: params.shieldBuff,
    weapon2AdrenalineCost: params.weapon2AdrenalineCost ?? 0,
  };
}

export function buildInitialLocalArenaHudData(
  params: BuildInitialLocalArenaHudDataParams,
): LocalArenaHudData {
  return buildLocalArenaHudData({
    hp: HP_MAX,
    maxHp: HP_MAX,
    armor: 0,
    maxArmor: params.maxArmor ?? 100,
    adrenaline: 0,
    maxAdrenaline: params.maxAdrenaline ?? ADRENALINE_MAX,
    rage: 0,
    maxRage: params.maxRage ?? RAGE_MAX,
    isUltimateActive: false,
    ultimateRequiredRage: params.ultimateRequiredRage,
    ultimateThresholds: params.ultimateThresholds,
    ultimateDisplayName: params.ultimateDisplayName,
    weapon1CooldownFrac: 0,
    weapon2CooldownFrac: 0,
    utilityCooldownFrac: 0,
    utilityDisplayName: params.utilityDisplayName,
    adrenalineSyringeActive: false,
    isUtilityOverridden: false,
    activePowerUps: [],
    weapon2AdrenalineCost: params.weapon2AdrenalineCost ?? 0,
  });
}
