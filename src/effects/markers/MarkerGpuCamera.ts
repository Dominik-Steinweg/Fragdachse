type Matrix = { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly tx: number; readonly ty: number };
type Camera = { readonly matrixCombined: Matrix; getViewMatrix(forceComposite: boolean): Matrix };

/** World badges draw on Clarity AFTER world compositing: always retain the external
 * viewport transform. getViewMatrix(false) still omits it when the World has filters.
 * The ground pass draws INSIDE its own world framebuffer and must omit that offset.
 */
export function writeMarkerGpuView(out: Float32Array, camera: Camera, worldOnClarity: boolean, useCanvas: boolean): void {
  const m = worldOnClarity ? camera.matrixCombined : camera.getViewMatrix(!useCanvas);
  out.set([m.a, m.b, 0, m.c, m.d, 0, m.tx, m.ty, 1]);
}
