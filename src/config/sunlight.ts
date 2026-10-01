import { resolveSkyState } from '../effects/TimeOfDay';
import { WORLD_GRADE_CLAMPS } from '../effects/postfx/worldGrade';

/** One mutable, presentation-owned parameter set; optics edit uniforms; rim geometry edits rebuild resident worker fields. */
export const SUN_TUNING_DEFAULTS = {
  rockFloraContact:.24, rockFloraBlend:.5,
  vegLight: 1, vegShadow: .44, vegShadowLength: 5, vegDomeBlur: 8,
  sunAzimuthOverride: null as number | null,
  canopyWrap: .12, canopyAO: 1, canopyTranslucency: .12, canopyHorizonSoftness: .07,
  canopySunWeight: 1.65, canopyAmbientWeight: .22,
  shade: [0.80, 0.85, 0.88] as readonly number[],
  /** Neutral clear sky, between cool cloud shade and rare warm openings. */
  daylight: [1.0, 1.0, .98] as readonly number[],
  sun: [1.62, 1.45, 1.08] as readonly number[],
  // Restrained warmth and bloom preserve foliage colour.
  gradeTemperature: 0.15, gradeContrast: 1.18, gradeBrightness: 1.06,
  gradeSaturation: 0.98, gradeBloomThreshold: 0.80, gradeBloomAmount: 0.16,
  gradeOlive: 0,
  fogShade: [0.78, 0.84, 0.90] as readonly number[],
  fogSun: [1.0, 0.94, 0.78] as readonly number[],
  /** Display-only multipliers: lit mist and shaded mist are tuned separately. */
  fogOpacity: 0.40, fogShadeOpacity: 0.35,
  fogCover: .35, fogBankScale: 950, fogWaterBoost: .35, fogShoreRamp: 110,
  fogBankCore: 1.6, fogBankEdge: 120, fogClearHaze: .002,
  fogPatchScale: 360, fogPatchDensity: 3.6, fogAreaBudget: .15, fogWaterAreaBudget: .12,
  fogMaxCover: .33, fogWaterMaxCover: .16, fogScatterBudget: .025,
  fogPileSoftness: 22, fogScatter: .22, fogDensity: .55,
  cloudCover: 0.35, cloudDensity: 0.5, cloudSpeed: 18, cloudScale: 900,
  cloudSpotAmount: .28, cloudSpotScale: 130,
  cloudEvolution: .32, cloudGust: .18, cloudWarp: .65, cloudSoftness: .25,
  cloudCanopyShade: [0.72, 0.76, 0.82] as readonly number[],
  rockEdgeFlora: 1, rockCreviceFlora: 1, rockFootFlora: 1,
  rockRimWidth: 12, rockRimHeight: 20, rockRimLip: 2.5, rockContactAO: .36,
  litterDensity: 1, pondFloraDensity: 1, waterGlint: .24,
  // Live-tuned: denser white glints read as fish or floating debris in stills.
  waterGlintDensity: .4, waterGlintSpeed: 1,
  rockLight: 1.35, rockShade: 0.60, rockCavity: 0.40, rockMoss: 0.85, rockTone: 0.08,
};
export type SunTuning = typeof SUN_TUNING_DEFAULTS;
export const SUN_TUNING_LIMITS = {
  rockFloraContact:[0,.5], rockFloraBlend:[0,1],
  vegLight: [0, 2], vegShadow: [0, .55], vegShadowLength: [3, 10], vegDomeBlur: [2, 12],
  rockEdgeFlora: [0,2], rockCreviceFlora: [0,2], rockFootFlora: [0,2],
  cloudSpotAmount: [0,.5], cloudSpotScale: [80,300],
  cloudEvolution: [0,1], cloudGust: [0,.45], cloudWarp: [0,1.2], cloudSoftness: [.12,.35],
  fogCover: [0,1], fogBankScale: [400,1400], fogWaterBoost: [0,.7], fogShoreRamp: [60,140],
  fogBankCore: [.5,2.5], fogBankEdge: [80,160], fogClearHaze: [0,.02],
  fogPatchScale: [220,580], fogPatchDensity: [0,6], fogAreaBudget: [0,.55], fogWaterAreaBudget: [0,.45],
  fogMaxCover: [.10,.65], fogWaterMaxCover: [.05,.40], fogScatterBudget: [0,.06],
  fogPileSoftness: [12,40], fogScatter: [0,.4], fogDensity: [.1,.7],
  canopyWrap: [0, .6], canopyAO: [0, 1], canopyTranslucency: [0, .4], canopyHorizonSoftness: [.01, .3],
  canopySunWeight: [0, 2.5], canopyAmbientWeight: [0, 1],
  litterDensity: [0, 2], pondFloraDensity: [0, 2], waterGlint: [0, .35],
  waterGlintDensity: [0, 1], waterGlintSpeed: [0, 3],
  gradeTemperature: WORLD_GRADE_CLAMPS.temperature, gradeContrast: WORLD_GRADE_CLAMPS.contrast,
  gradeBrightness: WORLD_GRADE_CLAMPS.brightness, gradeSaturation: WORLD_GRADE_CLAMPS.saturation,
  gradeBloomThreshold: WORLD_GRADE_CLAMPS.bloomThreshold, gradeBloomAmount: WORLD_GRADE_CLAMPS.bloomAmount,
  gradeOlive: [0, 0.08],
  fogOpacity: [0, 1.5], fogShadeOpacity: [0, 1],
  cloudCover: [0, 1], cloudDensity: [0, 1], cloudSpeed: [0, 40], cloudScale: [500, 1500],
  rockRimWidth: [4, 18], rockRimHeight: [0, 24], rockRimLip: [.5, 4], rockContactAO: [0, .45],
  rockLight: [1, 1.8], rockShade: [0.2, 1], rockCavity: [0, 1], rockMoss: [0, 1], rockTone: [0, 0.15],
} as const;


const frame = (minute: number, values: Partial<SunTuning>) => ({ minute, values: { ...SUN_TUNING_DEFAULTS, ...values } });
const night: Partial<SunTuning> = { shade:[1,1,1],daylight:[1,1,1],sun:[1,1,1],
  fogOpacity:.7,fogShadeOpacity:1,fogShade:[.65,.75,.96],fogSun:[.65,.75,.96],
  cloudCover:0,cloudDensity:0,gradeTemperature:0,gradeContrast:1,gradeBrightness:1,
  gradeSaturation:1,gradeBloomAmount:0 };
/** Ambient colour still comes from TimeOfDay. These are restrained relative
 * optics: sunset warmth is already strong in the world's ambient light. */
export const SUN_ATMOSPHERE_KEYFRAMES = [
  frame(0,night), frame(360,night),
  // User 2026-09-30: mornings carry clearly more mist; it thins through mid-morning.
  frame(420,{...night,fogOpacity:1.2,fogCover:.62,fogAreaBudget:.43,fogWaterAreaBudget:.36,
    fogMaxCover:.52,fogWaterMaxCover:.32}),
  frame(480,{shade:[.78,.84,.91],daylight:[1.01,1.01,.99],sun:[1.40,1.31,1.12],fogOpacity:1.5,fogShadeOpacity:.65,
    fogCover:.70,fogAreaBudget:.48,fogWaterAreaBudget:.40,
    fogMaxCover:.58,fogWaterMaxCover:.36,fogScatterBudget:.04,
    fogShade:[.70,.80,.94],fogSun:[1,.89,.65],
    cloudCover:.48,cloudDensity:.5,gradeTemperature:-.06,gradeContrast:1.08,gradeSaturation:.98}),
  frame(600,{shade:[.714,.772,.830],daylight:[.965,.965,.955],sun:[1.351,1.298,1.172],fogOpacity:1.15,fogShadeOpacity:.7,
    fogCover:.50,fogAreaBudget:.33,fogWaterAreaBudget:.22,
    fogMaxCover:.46,fogWaterMaxCover:.24,fogScatterBudget:.028,
    fogShade:[.74,.83,.94],fogSun:[1,.95,.81],
    cloudCover:.52,cloudDensity:.5,gradeTemperature:-.03,gradeContrast:1.13,gradeBrightness:1.045}),
  frame(720,{shade:[.72,.77,.82],daylight:[1.0,1.0,1.0],sun:[1.40,1.38,1.31],fogOpacity:.8,fogShadeOpacity:.75,
    fogCover:.25,fogAreaBudget:.12,fogWaterAreaBudget:.10,
    fogMaxCover:.32,fogWaterMaxCover:.10,fogScatterBudget:.015,
    fogShade:[.80,.88,.97],fogSun:[1,1,.96],
    cloudCover:.50,gradeTemperature:0,gradeContrast:1.18,gradeBrightness:1.03}),
  frame(1020,{shade:[.675,.729,.783],daylight:[.909,.90,.873],sun:[1.332,1.224,1.008],fogOpacity:1.0,fogShadeOpacity:.8,
    fogAreaBudget:.15,fogWaterAreaBudget:.12,cloudCover:.52,gradeTemperature:.06,gradeContrast:1.14}),
  frame(1140,{shade:[.65,.693,.792],daylight:[.90,.891,.891],sun:[1.188,1.107,1.008],fogOpacity:1.25,fogShadeOpacity:.8,
    fogCover:.40,fogAreaBudget:.20,fogWaterAreaBudget:.16,
    fogMaxCover:.36,fogWaterMaxCover:.18,fogScatterBudget:.025,
    fogShade:[.68,.72,.95],fogSun:[1,.83,.63],
    cloudCover:.50,cloudDensity:.5,gradeTemperature:0,gradeContrast:1.08,gradeBrightness:1.03,
    gradeSaturation:.86,gradeBloomAmount:.12}),
  frame(1185,{shade:[.693,.72,.837],daylight:[.90,.90,.90],sun:[1.026,.99,.954],fogOpacity:1.25,fogShadeOpacity:.9,
    fogCover:.40,fogAreaBudget:.20,fogWaterAreaBudget:.16,
    fogMaxCover:.32,fogWaterMaxCover:.16,fogScatterBudget:.02,
    fogShade:[.66,.71,.96],fogSun:[1,.72,.60],
    cloudCover:.50,cloudDensity:.5,gradeTemperature:0,gradeContrast:1.03,gradeBrightness:1,
    gradeSaturation:.86,gradeBloomAmount:.08}),
  frame(1215,night),
] as const;

export const SUN_SKY_KEYFRAMES = [
  { minute:1050, color:resolveSkyState(1050).ambientColor, weight:0 },
  { minute:1095, color:0xeac6a0, weight:1 },
  { minute:1155, color:0xd4abb5, weight:1 },
  { minute:1185, color:0xa091ba, weight:1 },
  // Ends at 20:45: production is violet there. Ending at 20:15 borrowed the red
  // 19:45 production keyframe and produced a violet -> red -> violet bounce.
  { minute:1245, color:resolveSkyState(1245).ambientColor, weight:0 },
] as const;

export const EVENING_SUN = [[1050,1],[1095,.95],[1155,.75],[1185,.25],[1215,0]] as const;
export const SUN_PATH = { sunrise: 360, noon: 720, sunset: 1215, stepDegrees: 6 } as const;
