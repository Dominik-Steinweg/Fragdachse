/** Artist-facing controls; sampling and fidelity are deliberately not configurable. */
export interface FlightSignatureTuning {
  readonly coreIntensity: number;
  readonly coreWidth: number;
  /** Hot core length in pixels at the reference speed (1000 px/s). */
  readonly coreLength: number;
  readonly wakePersistence: number;
  readonly wakeSpread: number;
  readonly heatContrast: number;
  readonly wakeTurbulence: number;
  readonly moteAmount: number;
  readonly speedResponse: number;
}

export const FLIGHT_SIGNATURE_PROFILES = {
  light:      { coreIntensity: 0.82, coreWidth: 1.25, coreLength: 48,  wakePersistence: 105, wakeSpread: 1.8, heatContrast: 0.78, wakeTurbulence: 0.16, moteAmount: 0.025, speedResponse: 0.65 },
  automatic:  { coreIntensity: 0.8,  coreWidth: 1.1,  coreLength: 55,  wakePersistence: 85,  wakeSpread: 2.0, heatContrast: 0.8,  wakeTurbulence: 0.2,  moteAmount: 0.015, speedResponse: 0.6 },
  heavy:      { coreIntensity: 0.95, coreWidth: 1.65, coreLength: 90,  wakePersistence: 170, wakeSpread: 4.5, heatContrast: 0.88, wakeTurbulence: 0.4,  moteAmount: 0.07,  speedResponse: 0.65 },
  sustained:  { coreIntensity: 0.78, coreWidth: 1.15, coreLength: 42,  wakePersistence: 80,  wakeSpread: 2.0, heatContrast: 0.82, wakeTurbulence: 0.45, moteAmount: 0.012, speedResponse: 0.55 },
  scatter:    { coreIntensity: 0.82, coreWidth: 1.9,  coreLength: 28,  wakePersistence: 65,  wakeSpread: 1.0, heatContrast: 0.75, wakeTurbulence: 0.08, moteAmount: 0.008, speedResponse: 0.4 },
  sniper:     { coreIntensity: 1,    coreWidth: 1.4,  coreLength: 220, wakePersistence: 270, wakeSpread: 3.2, heatContrast: 0.93, wakeTurbulence: 0.18, moteAmount: 0.025, speedResponse: 0.85 },
  highEnergy: { coreIntensity: 1,    coreWidth: 2.6,  coreLength: 150, wakePersistence: 235, wakeSpread: 5.5, heatContrast: 0.95, wakeTurbulence: 0.42, moteAmount: 0.1,   speedResponse: 0.7 },
} as const satisfies Record<string, FlightSignatureTuning>;

export type FlightSignatureProfile = keyof typeof FLIGHT_SIGNATURE_PROFILES;
export interface FlightSignatureConfig extends Partial<FlightSignatureTuning> {
  readonly profile: FlightSignatureProfile;
  /** Existing weapon / Void palettes can override the owner's accent color. */
  readonly color?: number;
}
export const FLIGHT_SIGNATURE_FIELDS = [
  'coreIntensity', 'coreWidth', 'coreLength', 'wakePersistence', 'wakeSpread', 'heatContrast',
  'wakeTurbulence', 'moteAmount', 'speedResponse', 'color',
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
    && (!['coreIntensity', 'heatContrast', 'wakeTurbulence', 'moteAmount', 'speedResponse'].includes(key) || val <= 1)
    && (key !== 'coreIntensity' || val >= 0.35)
    && (key !== 'coreWidth' || (val >= 0.6 && val <= 8))
    && (key !== 'coreLength' || (val >= 8 && val <= 400))
    && (key !== 'wakePersistence' || val <= 500)
    && (key !== 'wakeSpread' || val <= 12)
    && (key !== 'color' || (Number.isInteger(val) && val <= 0xffffff))
  ));
}
