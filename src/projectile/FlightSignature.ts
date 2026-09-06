/** Artist-facing controls; sampling and fidelity are deliberately not configurable. */
export interface FlightSignatureTuning {
  readonly coreIntensity: number;
  readonly coreWidth: number;
  /** Hot core length in pixels at the reference speed (1000 px/s). */
  readonly coreLength: number;
  /** Wake opacity (0–1), independent of core brightness. */
  readonly wakeIntensity: number;
  /** Additional wake lifetime after the hot core, in milliseconds. */
  readonly wakePersistence: number;
  readonly wakeSpread: number;
  readonly heatContrast: number;
  readonly wakeTurbulence: number;
  readonly moteAmount: number;
  readonly speedResponse: number;
}

export const FLIGHT_SIGNATURE_PROFILES = {
  // Crisp, substantial streaks with a tighter wake than the rifle families.
  light: {
    coreIntensity: 0.94, coreWidth: 1.44, coreLength: 300,
    wakeIntensity: 0.52, wakePersistence: 315, wakeSpread: 4.5,
    heatContrast: 0.82, wakeTurbulence: 0.16, moteAmount: 0.025, speedResponse: 0.65,
  },
  // The manually approved P90 length/persistence anchors the system-wide direction.
  automatic: {
    coreIntensity: 0.98, coreWidth: 1.74, coreLength: 400,
    wakeIntensity: 0.64, wakePersistence: 375, wakeSpread: 6.5,
    heatContrast: 0.86, wakeTurbulence: 0.22, moteAmount: 0.015, speedResponse: 0.6,
  },
  heavy: {
    coreIntensity: 1, coreWidth: 2.16, coreLength: 440,
    wakeIntensity: 0.72, wakePersistence: 375, wakeSpread: 8,
    heatContrast: 0.9, wakeTurbulence: 0.36, moteAmount: 0.07, speedResponse: 0.65,
  },
  // Dense continuous fire stays long and bright, with less lateral coverage and debris.
  sustained: {
    coreIntensity: 0.94, coreWidth: 1.62, coreLength: 360,
    wakeIntensity: 0.56, wakePersistence: 330, wakeSpread: 5.2,
    heatContrast: 0.86, wakeTurbulence: 0.28, moteAmount: 0.012, speedResponse: 0.55,
  },
  scatter: {
    coreIntensity: 0.96, coreWidth: 2.28, coreLength: 210,
    wakeIntensity: 0.54, wakePersistence: 225, wakeSpread: 3.2,
    heatContrast: 0.8, wakeTurbulence: 0.08, moteAmount: 0.008, speedResponse: 0.4,
  },
  sniper: {
    coreIntensity: 1, coreWidth: 1.68, coreLength: 500,
    wakeIntensity: 0.68, wakePersistence: 375, wakeSpread: 6,
    heatContrast: 0.95, wakeTurbulence: 0.14, moteAmount: 0.025, speedResponse: 0.85,
  },
  highEnergy: {
    coreIntensity: 1, coreWidth: 2.58, coreLength: 480,
    wakeIntensity: 0.78, wakePersistence: 375, wakeSpread: 9.5,
    heatContrast: 0.96, wakeTurbulence: 0.38, moteAmount: 0.1, speedResponse: 0.7,
  },
} as const satisfies Record<string, FlightSignatureTuning>;

export type FlightSignatureProfile = keyof typeof FLIGHT_SIGNATURE_PROFILES;
export interface FlightSignatureConfig extends Partial<FlightSignatureTuning> {
  readonly profile: FlightSignatureProfile;
  /** Existing weapon / Void palettes can override the owner's accent color. */
  readonly color?: number;
}
export const FLIGHT_SIGNATURE_FIELDS = [
  'coreIntensity', 'coreWidth', 'coreLength', 'wakePersistence', 'wakeSpread', 'heatContrast',
  'wakeTurbulence', 'moteAmount', 'speedResponse', 'color', 'wakeIntensity',
] as const;

export function resolveFlightSignature(config: FlightSignatureConfig): FlightSignatureTuning {
  if (!validateFlightSignature(config)) throw new Error("Invalid flight signature tuning");
  const profile = FLIGHT_SIGNATURE_PROFILES[config.profile];
  if (!profile) throw new Error(`Unknown flight signature profile: ${config.profile}`);
  return { ...profile, ...config };
}

export function validateFlightSignature(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  if (typeof config.profile !== 'string' || !Object.prototype.hasOwnProperty.call(FLIGHT_SIGNATURE_PROFILES, config.profile)) return false;
  return Object.entries(config).every(([key, val]) => key === 'profile' || (
    (FLIGHT_SIGNATURE_FIELDS as readonly string[]).includes(key) && typeof val === 'number'
    && Number.isFinite(val) && val >= 0
    && (!['coreIntensity', 'wakeIntensity', 'heatContrast', 'wakeTurbulence', 'moteAmount', 'speedResponse'].includes(key) || val <= 1)
    && (key !== 'coreIntensity' || val >= 0.35)
    && (key !== 'coreWidth' || (val >= 0.6 && val <= 8))
    && (key !== 'coreLength' || (val >= 8 && val <= 500))
    && (key !== 'wakePersistence' || val <= 500)
    && (key !== 'wakeSpread' || val <= 12)
    && (key !== 'color' || (Number.isInteger(val) && val <= 0xffffff))
  ));
}
