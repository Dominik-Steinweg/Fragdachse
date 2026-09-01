import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import {
  ArenaDiagnosticsController,
  ArenaDiagnosticsFrame,
  type ArenaDiagnosticsInput,
} from '../src/scenes/arena/ArenaDiagnosticsController';
import { ArenaRuntimeProfiler } from '../src/scenes/arena/ArenaRuntimeProfiler';
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
    getFlowFieldCoordinator: () => null,
    getRockVisualSystem: () => null,
    getHostPerformanceMetrics: vi.fn() as unknown as ArenaDiagnosticsInput['getHostPerformanceMetrics'],
    getClientPerformanceMetrics: vi.fn() as unknown as ArenaDiagnosticsInput['getClientPerformanceMetrics'],
    getFrameMetrics: vi.fn() as unknown as ArenaDiagnosticsInput['getFrameMetrics'],
  };
  return { input, payloadSink };
}

describe('ArenaDiagnosticsController', () => {
  it('sammelt benannte Frame-Abschnitte und behandelt fehlende Messpunkte neutral', () => {
    const frame = new ArenaDiagnosticsFrame();

    frame.mark('networkStart');
    frame.begin('primaryStep');
    frame.end('primaryStep');
    frame.mark('networkEnd');

    expect(frame.duration('primaryStep')).toBeGreaterThanOrEqual(0);
    expect(frame.between('networkStart', 'networkEnd')).toBeGreaterThanOrEqual(0);
    expect(frame.duration('networkUpdate')).toBe(0);
    expect(frame.sinceStart('updateEnd')).toBe(0);
  });

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

    const unsubscribeSpies: Array<ReturnType<typeof vi.fn>> = [];
    const originalSubscribe = ArenaRuntimeProfiler.prototype.subscribeDiagnostics;
    vi.spyOn(ArenaRuntimeProfiler.prototype, 'subscribeDiagnostics').mockImplementation(function (this: ArenaRuntimeProfiler, listener) {
      const realUnsubscribe = originalSubscribe.call(this, listener);
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
    const recordSpy = vi.spyOn(ArenaRuntimeProfiler.prototype, 'recordSemanticEvent');
    const controller = new ArenaDiagnosticsController(input);

    const sink = controller.getSemanticEventSink();
    sink('test:event', { foo: 1 });

    expect(recordSpy).toHaveBeenCalledWith('test:event', { foo: 1 });

    controller.destroy();
    recordSpy.mockClear();
    sink('test:event-after-destroy', {});
    expect(recordSpy).not.toHaveBeenCalled();
  });
});
