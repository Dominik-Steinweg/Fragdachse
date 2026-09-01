import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import {
  ArenaDiagnosticsController,
  type ArenaDiagnosticsInput,
} from '../src/scenes/arena/ArenaDiagnosticsController';
import type { ChunkRenderingDiagnosticsState } from '../src/ui/PerformanceDiagnosticsOverlay';

function fakeChunkDiagnosticsState(): ChunkRenderingDiagnosticsState {
  return {
    staticShadows: true,
    groundSurface: true,
    rockOverlay: true,
    chunkSampling: 'default',
    rockRenderer: 'spriteGpu',
    rockGpuPageSize: 512,
    rockGpu: null,
  };
}

/** Minimaler, DOM-freier Input: keine echte ArenaScene, nur Fakes/No-ops fuer alle Ports. */
function makeInput(): { input: ArenaDiagnosticsInput; payloadSink: { setSink: ReturnType<typeof vi.fn> } } {
  const payloadSink = { setSink: vi.fn() };
  const game = {
    canvas: {},
    renderer: {},
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as ArenaDiagnosticsInput['game'];
  const graphicsQuality = {
    subscribe: vi.fn(() => () => {}),
  } as unknown as ArenaDiagnosticsInput['graphicsQuality'];

  const input: ArenaDiagnosticsInput = {
    scene: {} as unknown as ArenaDiagnosticsInput['scene'],
    game,
    graphicsQuality,
    payloadDiagnostics: payloadSink,
    onRecordingStart: vi.fn(),
    captureSceneInspection: vi.fn(),
    getShadowSystem: () => null,
    getLightingSystem: () => null,
    getPostFxController: () => null,
    getGpuParticleSuppressor: () => null,
    getVectorLighting: () => null,
    chunkDiagnostics: {
      getState: () => fakeChunkDiagnosticsState(),
      setStaticShadowsVisible: vi.fn(),
      setGroundSurfaceVisible: vi.fn(),
      setRockOverlayVisible: vi.fn(),
      setChunkSampling: vi.fn(),
      setRockRenderer: vi.fn(),
      setRockGpuPageSize: vi.fn(),
    },
    getGpuVfxStats: () => null,
    getRockVisualSystem: () => null,
  };
  return { input, payloadSink };
}

describe('ArenaDiagnosticsController', () => {
  it('ist nach destroy idempotent', () => {
    const { input } = makeInput();
    const controller = new ArenaDiagnosticsController(input);

    expect(() => {
      controller.destroy();
      controller.destroy();
    }).not.toThrow();
  });

  it('bestellt beim destroy alle subscribeDiagnostics-Listener ab', () => {
    const { input } = makeInput();
    const controller = new ArenaDiagnosticsController(input);
    const profiler = controller.profiler;
    expect(profiler).not.toBeNull();

    const unsubscribeSpies: Array<ReturnType<typeof vi.fn>> = [];
    const originalSubscribe = profiler!.subscribeDiagnostics.bind(profiler);
    vi.spyOn(profiler!, 'subscribeDiagnostics').mockImplementation((listener) => {
      const realUnsubscribe = originalSubscribe(listener);
      const unsubscribeSpy = vi.fn(realUnsubscribe);
      unsubscribeSpies.push(unsubscribeSpy);
      return unsubscribeSpy;
    });

    controller.subscribeDiagnostics(() => {});
    controller.subscribeDiagnostics(() => {});
    expect(unsubscribeSpies).toHaveLength(2);
    for (const unsubscribeSpy of unsubscribeSpies) expect(unsubscribeSpy).not.toHaveBeenCalled();

    controller.destroy();

    for (const unsubscribeSpy of unsubscribeSpies) expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('setzt beim destroy den injizierten Payload-Diagnostics-Sink auf null', () => {
    const { input, payloadSink } = makeInput();
    const controller = new ArenaDiagnosticsController(input);

    expect(payloadSink.setSink).not.toHaveBeenCalledWith(null);
    controller.destroy();

    expect(payloadSink.setSink).toHaveBeenCalledWith(null);
  });

  it('macht Overlay-Ziele und updateAblation nach destroy wirkungslos statt zu werfen', () => {
    const { input } = makeInput();
    const controller = new ArenaDiagnosticsController(input);
    controller.destroy();

    expect(() => {
      controller.toggleNetDebug();
      controller.togglePerformanceOverlay();
      controller.updateAblation();
    }).not.toThrow();
    expect(controller.isNetDebugOpen()).toBe(false);
    expect(controller.isPerformanceOverlayOpen()).toBe(false);
  });

  it('nimmt nach destroy keine GPU-VFX-Bindung mehr an', () => {
    const { input } = makeInput();
    const controller = new ArenaDiagnosticsController(input);
    controller.destroy();

    const gpuVfx = {
      buildReport: vi.fn(),
      resetProfiling: vi.fn(),
      setDiagnosticEventSink: vi.fn(),
    } as unknown as Parameters<ArenaDiagnosticsController['attachGpuVfx']>[0];

    expect(() => controller.attachGpuVfx(gpuVfx)).not.toThrow();
    // Ein zerstoerter Owner darf sich nicht erneut an ein scene-langlebiges System haengen.
    expect(gpuVfx.setDiagnosticEventSink).not.toHaveBeenCalled();
  });

  it('reicht getSemanticEventSink Events an den Profiler weiter, solange der Controller lebt', () => {
    const { input } = makeInput();
    const controller = new ArenaDiagnosticsController(input);
    const profiler = controller.profiler;
    expect(profiler).not.toBeNull();
    const recordSpy = vi.spyOn(profiler!, 'recordSemanticEvent');

    const sink = controller.getSemanticEventSink();
    sink('test:event', { foo: 1 });

    expect(recordSpy).toHaveBeenCalledWith('test:event', { foo: 1 });

    controller.destroy();
    recordSpy.mockClear();
    sink('test:event-after-destroy', {});
    expect(recordSpy).not.toHaveBeenCalled();
  });
});
