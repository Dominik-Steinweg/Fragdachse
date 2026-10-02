/** Draft for 22c. No runtime import or dependency is introduced by this file. */
export type Vec3 = [number, number, number];
export interface MeshSocket {
  position: Vec3;
  /** Row-major proper rotation. Convert Blender with C * R * C, C=diag(1,-1,1). */
  rotationMatrix: [number, number, number, number, number, number, number, number, number];
  yaw: number;
  sourceObject: string;
  mount?: 'right-palm';
}
export interface MeshBinary { file: string; bytes: number; sha256: string }
export interface ShadowMesh {
  id: string;
  /** Present for held weapons/utilities; exact catalog and Beauty-registry IDs. */
  gameIds?: string[];
  sourceRole?: string;
  /** Static union proxies; absent in legacy per-part pilots. */
  budget?: { policy: 'held-size-v2' | 'held-adaptive-v3'; sizeWorld: number; baseVertices?: number; maxVertices: number; maxTriangles: number };
  encoding: 'uint16-le-xyz-bounds';
  bounds: { min: Vec3; max: Vec3 };
  vertexCount: number;
  triangleCount: number;
  /** Binary pose slots map to these beauty frame indices, not Blender timeline frames. */
  poseIndices: number[];
  positions: MeshBinary;
  indices: MeshBinary & { encoding: 'uint16-le-triangles' };
  topologySha256: string;
  downloadBytes: number;
  gpuFloat32Bytes: number;
  quantizationMaxErrorWorld: Vec3;
  /** Weapon positions and these anchors are grip-local, at display size 38.4. */
  grip?: Vec3;
  muzzle?: Vec3;
  beautyCanvasWorldPx?: number;
  beautyGripUv?: [number, number];
}
export interface CharacterMeshManifest {
  schema: 'fd-projected-character-mesh'; version: 1; status: 'pilot-unreviewed' | 'production-unreviewed'; revision: string;
  coordinates: { axes: 'X-right/Y-south/Z-up'; blenderToAsset: Vec3; groundZ: 0; pivot: Vec3;
    bodyCanvasWorldPx: 38.4; bodyOrthoScaleBlender: 2.2 };
  poses: { index: number; blenderFrame: number; clip: string; clipFrame: number; beautySha256: string }[];
  sockets: { pose: number; left: MeshSocket; right: MeshSocket; weapon: MeshSocket }[];
  meshes: ShadowMesh[];
  sourceFiles: Record<string, string>;
  blenderVersion: string;
  geometryWallSeconds: number;
  /** Totals in production; binaries only, no JSON/review/archive. */
  downloadBytes?: number;
  gpuQuantizedBytes?: number;
  gpuFloat32Bytes?: number;
  /** Authoring/review only; baseline buffers are NOT runtime payload. */
  shadowRepair?: {
    method: 'badger-hip-connectors-v1';
    baseline: ShadowMesh;
    baselineVertexCount: number;
    baselineTriangleCount: number;
    addedVertices: number;
    addedTriangles: number;
    parameters: { radius: number; hipInward: number; topFraction: number };
    anchors: { leg: string; legVertexIds: number[]; pelvisVertexIds: number[]; pelvisCenterIds: number[] }[];
    evidence: { pose: number; leg: string; start: Vec3; end: Vec3; endpointClearanceWorld: [number, number]; radiiWorld: number[]; lengthWorld: number }[];
  };
}
