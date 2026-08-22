export type WebGLRendererType = 'webgl2' | 'webgl1';

export type FragdachseWebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

export interface WebGLStartupContext {
  readonly canvas: HTMLCanvasElement;
  readonly context: FragdachseWebGLContext;
  readonly rendererType: WebGLRendererType;
}

// Keep these attributes aligned with Phaser's WebGLRenderer defaults for the current game
// configuration. The context is created before Phaser, so Phaser cannot apply them later.
const WEBGL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  depth: true,
  antialias: true,
  premultipliedAlpha: true,
  stencil: true,
  desynchronized: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'default',
  preserveDrawingBuffer: false,
};

function tryGetContext(
  canvas: HTMLCanvasElement,
  contextId: 'webgl2' | 'webgl' | 'experimental-webgl',
): FragdachseWebGLContext | null {
  try {
    return canvas.getContext(contextId, WEBGL_CONTEXT_ATTRIBUTES) as FragdachseWebGLContext | null;
  } catch {
    return null;
  }
}

function isUsableContext(context: FragdachseWebGLContext | null): context is FragdachseWebGLContext {
  return context !== null && !context.isContextLost();
}

/** Creates the context Phaser will use, preferring WebGL2 without making it mandatory. */
export function createWebGLStartupContext(): WebGLStartupContext | null {
  const preferredCanvas = document.createElement('canvas');
  const webgl2 = tryGetContext(preferredCanvas, 'webgl2');
  if (isUsableContext(webgl2)) {
    return { canvas: preferredCanvas, context: webgl2, rendererType: 'webgl2' };
  }

  // A lost WebGL2 context cannot safely be replaced by a WebGL1 context on the same canvas.
  const fallbackCanvas = webgl2 ? document.createElement('canvas') : preferredCanvas;
  const webgl1 = tryGetContext(fallbackCanvas, 'webgl')
    ?? tryGetContext(fallbackCanvas, 'experimental-webgl');
  if (!isUsableContext(webgl1)) return null;

  return { canvas: fallbackCanvas, context: webgl1, rendererType: 'webgl1' };
}

/** Detects the actual WebGL generation without relying on a cross-realm instanceof check. */
export function getWebGLRendererType(context: FragdachseWebGLContext): WebGLRendererType {
  const version = context.getParameter(context.VERSION);
  return typeof version === 'string' && version.includes('WebGL 2') ? 'webgl2' : 'webgl1';
}
