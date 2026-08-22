import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebGLStartupContext,
  getWebGLRendererType,
} from '../src/utils/webglContext';

type FakeWebGLContext = {
  readonly isContextLost: () => boolean;
};

function context(isLost = false): FakeWebGLContext {
  return { isContextLost: () => isLost };
}

function canvas(contexts: Record<string, FakeWebGLContext | null>): HTMLCanvasElement {
  return {
    getContext: vi.fn((contextId: string) => contexts[contextId] ?? null),
  } as unknown as HTMLCanvasElement;
}

function installDocument(canvases: readonly HTMLCanvasElement[]): void {
  let index = 0;
  vi.stubGlobal('document', {
    createElement: vi.fn(() => canvases[Math.min(index++, canvases.length - 1)]),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebGL startup context', () => {
  it('prefers WebGL2 and passes its canvas/context pair through', () => {
    const webgl2 = context();
    const startupCanvas = canvas({ webgl2 });
    installDocument([startupCanvas]);

    const result = createWebGLStartupContext();

    expect(result).toEqual({ canvas: startupCanvas, context: webgl2, rendererType: 'webgl2' });
    expect(startupCanvas.getContext).toHaveBeenCalledWith('webgl2', expect.any(Object));
    expect(startupCanvas.getContext).not.toHaveBeenCalledWith('webgl', expect.anything());
  });

  it('falls back to WebGL1 on the same canvas when WebGL2 is unavailable', () => {
    const webgl1 = context();
    const startupCanvas = canvas({ webgl: webgl1 });
    installDocument([startupCanvas]);

    const result = createWebGLStartupContext();

    expect(result).toEqual({ canvas: startupCanvas, context: webgl1, rendererType: 'webgl1' });
    expect(startupCanvas.getContext).toHaveBeenCalledWith('webgl', expect.any(Object));
  });

  it('falls back when WebGL2 context creation throws', () => {
    const webgl1 = context();
    const startupCanvas = {
      getContext: vi.fn((contextId: string) => {
        if (contextId === 'webgl2') throw new Error('WebGL2 unavailable');
        return contextId === 'webgl' ? webgl1 : null;
      }),
    } as unknown as HTMLCanvasElement;
    installDocument([startupCanvas]);

    const result = createWebGLStartupContext();

    expect(result).toEqual({ canvas: startupCanvas, context: webgl1, rendererType: 'webgl1' });
  });

  it('keeps the previous experimental WebGL1 fallback', () => {
    const experimental = context();
    const startupCanvas = canvas({ 'experimental-webgl': experimental });
    installDocument([startupCanvas]);

    const result = createWebGLStartupContext();

    expect(result).toEqual({ canvas: startupCanvas, context: experimental, rendererType: 'webgl1' });
    expect(startupCanvas.getContext).toHaveBeenCalledWith('experimental-webgl', expect.any(Object));
  });

  it('uses a fresh canvas after a lost WebGL2 context', () => {
    const lostCanvas = canvas({ webgl2: context(true) });
    const webgl1 = context();
    const fallbackCanvas = canvas({ webgl: webgl1 });
    installDocument([lostCanvas, fallbackCanvas]);

    const result = createWebGLStartupContext();

    expect(result).toEqual({ canvas: fallbackCanvas, context: webgl1, rendererType: 'webgl1' });
  });

  it('returns null when no WebGL context can be created', () => {
    const startupCanvas = canvas({});
    installDocument([startupCanvas]);

    expect(createWebGLStartupContext()).toBeNull();
  });

  it('detects the renderer generation from the context version', () => {
    const versionContext = {
      VERSION: 0x1f02,
      getParameter: vi.fn(() => 'WebGL 2.0 (test)'),
    } as unknown as WebGLRenderingContext;

    expect(getWebGLRendererType(versionContext)).toBe('webgl2');
    expect(getWebGLRendererType({
      VERSION: 0x1f02,
      getParameter: vi.fn(() => 'WebGL 1.0 (test)'),
    } as unknown as WebGLRenderingContext)).toBe('webgl1');
  });
});
