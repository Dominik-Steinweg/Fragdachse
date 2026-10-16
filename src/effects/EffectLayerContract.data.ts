// R0 diagnostic data. No renderer imports this module. See docs/depth-layering.md.
// The catalog lives as one JSON file per GPU lane, GPU effect and render owner under layerContracts/,
// so parallel features add their own file instead of editing one shared list.
import type { LayerBlend, LayerContract } from './EffectLayerContract';
import type { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxLaneId } from './gpu/GpuVfxRenderLanes';

type GpuLaneName = keyof typeof GpuVfxLaneId;
type GpuEffectName = keyof typeof GpuVfxEffectId;
export type GpuEffectLayerContract = LayerContract & { readonly lanes: readonly GpuLaneName[] };
/** Observed depth/blend/camera call sites of one CPU render owner (source path relative to src/). */
export interface CpuSourceContract {
  readonly blends: readonly string[];
  readonly cameras: readonly string[];
  readonly sites: readonly { readonly key: string; readonly expression: string; readonly blends: readonly LayerBlend[] }[];
  readonly bindings: Readonly<Record<string, unknown>>;
}
interface NamedContractFile<T> { readonly name: string; readonly notes?: readonly string[]; readonly contract: T }
/** layerContracts/owners/<owner path with dots>.json */
interface OwnerContractFile {
  readonly owner: string;
  readonly notes?: readonly string[];
  /** CPU render owner: its observed call sites. */
  readonly source?: CpuSourceContract;
  /** CPU layers, checked against `source`. */
  readonly cpuLayers?: readonly LayerContract[];
  /** Layers of a dedicated GPU layer that is not a GpuVfx lane. */
  readonly gpuLayers?: readonly LayerContract[];
}

const files = <T>(entries: Record<string, T>) => Object.keys(entries).sort().map(path => entries[path]);
const lanes = files(import.meta.glob<NamedContractFile<LayerContract>>('./layerContracts/gpu-lanes/*.json', { eager: true, import: 'default' }));
const effects = files(import.meta.glob<NamedContractFile<GpuEffectLayerContract>>('./layerContracts/gpu-effects/*.json', { eager: true, import: 'default' }));
const owners = files(import.meta.glob<OwnerContractFile>('./layerContracts/owners/*.json', { eager: true, import: 'default' }));

export const GPU_LAYER_CONTRACTS = Object.fromEntries(lanes.map(file => [file.name, file.contract])) as Readonly<Record<GpuLaneName, LayerContract>>;
export const GPU_EFFECT_CONTRACTS = Object.fromEntries(effects.map(file => [file.name, file.contract])) as Readonly<Record<GpuEffectName, GpuEffectLayerContract>>;
export const CPU_SOURCE_CONTRACTS: Readonly<Record<string, CpuSourceContract>> =
  Object.fromEntries(owners.flatMap(file => (file.source ? [[file.owner, file.source]] : [])));
export const CPU_LAYER_CONTRACTS: readonly LayerContract[] = owners.flatMap(file => file.cpuLayers ?? []);
export const EFFECT_LAYER_CONTRACTS: readonly LayerContract[] = [
  ...Object.values(GPU_LAYER_CONTRACTS), ...Object.values(GPU_EFFECT_CONTRACTS), ...CPU_LAYER_CONTRACTS,
  ...owners.flatMap(file => file.gpuLayers ?? []),
];
