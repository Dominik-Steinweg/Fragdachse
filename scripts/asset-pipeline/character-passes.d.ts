/** Draft only. No Runtime import/asset selection is enabled by these types. */
export type PassKind = 'shadow' | 'albedo' | 'normal';
export interface PassCanvas {
  azimuthIndex: number;
  elevationIndex: number;
  /** Asset-local world units; X right, Y south. Stable across ALL source poses. */
  boundsWorld: [number, number, number, number];
  width: number;
  height: number;
  texelsPerWorldPx: number;
  /** Origin can be outside the rectangle. Never clamp it into [0,1]. */
  pivotPx: [number, number];
  /** x=a*px+c*py+tx, y=b*px+d*py+ty. Sample texel centers at px+.5, py+.5. */
  pixelToWorld: [number, number, number, number, number, number];
}
export interface PassImage {
  pass: PassKind;
  pose: number;
  canvasIndex?: number;
  file: string;
  width: number;
  height: number;
  channels: 1 | 4;
  encoding: 'unorm8-linear' | 'srgb8-straight-rgba' | 'unorm8-linear-rgb-normal-a-ao';
  premultiplied: false;
  sha256: string;
  downloadBytes: number;
  gpuBytesRGBA8: number;
}
export interface PackedShadowSample {
  pose: number;
  canvasIndex: number;
  page: number;
  channel: 0 | 1 | 2 | 3;
  rect: [number, number, number, number];
}
export interface PassSourceBinding {
  blendSha256: string;
  renderSha256: string;
  selectionSha256: string;
  specSha256: string;
  /** Present on new sealed 21c revisions; historical pilots remain readable. */
  authoredSpecSha256?: string;
  beautyArchiveSha256?: string;
  tools: Record<string, string>;
}
export interface PassPose {
  index: number;
  blenderFrame: number;
  beautyFile: string;
  beautySha256: string;
}
export interface PassPage {
  pass: PassKind;
  file: string;
  width: number;
  height: number;
  encoding: string;
  premultiplied: false;
  sha256: string;
  downloadBytes: number;
  /** width * height * 4, no mipmaps; shared by all instances. */
  gpuBytes: number;
}
export interface CharacterPassAtlasDraft {
  schema: 'fd-character-pass-atlas';
  version: 1;
  status: 'pilot-unreviewed' | 'production-unreviewed';
  source: PassSourceBinding;
  renderManifestSha256: string;
  coordinates: { axes: ['right', 'south', 'up']; blenderToAsset: [1, -1, 1];
    pivotBlender: [0, 0, 0]; groundZBlender: number; bodyPivotUV: [.5, .5];
    bodyCanvasWorldPx: number; bodyOrthoScaleBlender: number; azimuth: string; normal: string };
  grid: { azimuthDegrees: number[]; elevationDegrees: number[]; interpolation: string };
  poses: PassPose[];
  canvases: PassCanvas[];
  pages: PassPage[];
  samples: (PackedShadowSample & { pass: 'shadow' } | {
    pass: 'albedo' | 'normal'; pose: number; sourceSize: number; page: number;
    rect: [number, number, number, number] })[];
  mipmaps: false;
  totalDownloadBytes: number;
  totalGpuBytes: number;
}
/** Byte-preserving 21d publication draft, explicitly activated by the later runtime. */
export interface CharacterPassRuntimeDraft extends Omit<CharacterPassAtlasDraft, 'schema' | 'pages'> {
  schema: 'fd-character-pass-runtime';
  revision: string;
  assetId: 'badger';
  sourceSelectionSha256: string;
  sourceArchiveSha256: string;
  pages: (PassPage & { url: string; textureRole: 'colour' | 'data'; colourSpace: 'srgb' | 'linear';
    unpackPremultiplyAlpha: false; unpackColorSpaceConversion: 'none' })[];
  publication: { folder: string; source: string; activation: string };
}
