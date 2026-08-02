import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import {
  RADIAL_FOCUS_DESATURATE,
  RADIAL_FOCUS_DARKEN,
  RADIAL_FOCUS_KERNEL_TAP_COUNT,
  RADIAL_FOCUS_SOFTNESS_PX,
  resolveRadialFocusSampling,
  type RadialFocusFrame,
  type RadialFocusQualityLevel,
} from './radialFocusState';

export const RADIAL_FOCUS_RENDER_NODE = 'FragdachseRadialFocus';
export type { RadialFocusFrame, RadialFocusQualityLevel } from './radialFocusState';

const RADIAL_FOCUS_FRAGMENT_SHADER = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 uDesignSize;',
  'uniform vec2 uFocus;',
  'uniform vec4 uArenaRect;',
  'uniform float uRadius;',
  'uniform float uSoftness;',
  'uniform float uAlpha;',
  'uniform float uBlurRadius;',
  'uniform float uSampleCount;',
  'uniform float uDarken;',
  'uniform float uDesaturate;',
  'varying vec2 outTexCoord;',
  '#pragma phaserTemplate(fragmentHeader)',
  'const int MAX_KERNEL_TAPS = 9;',
  'const float KERNEL_CORNER_RADIUS_SCALE = 0.70710678;',
  '',
  'void main ()',
  '{',
  '    vec4 source = boundedSampler(uMainSampler, outTexCoord);',
  '    // Filter UVs use a bottom-left origin; frame coordinates use screen top-left.',
  '    vec2 screenUv = vec2(outTexCoord.x, 1.0 - outTexCoord.y);',
  '    vec2 screenPx = screenUv * uDesignSize;',
  '',
  '    if (screenPx.x < uArenaRect.x || screenPx.y < uArenaRect.y',
  '        || screenPx.x > uArenaRect.x + uArenaRect.z',
  '        || screenPx.y > uArenaRect.y + uArenaRect.w)',
  '    {',
  '        gl_FragColor = source;',
  '        return;',
  '    }',
  '',
  '    float distancePx = length(screenPx - uFocus);',
  '    float blurMix = uRadius <= 0.0',
  '        ? 1.0',
  '        : smoothstep(uRadius, uRadius + uSoftness, distancePx);',
  '    blurMix = clamp(blurMix * uAlpha, 0.0, 1.0);',
  '',
  '    float blurScale = mix(0.35, 1.0, blurMix);',
  '    // Symmetric 3x3 area kernel: center plus eight taps spread across the footprint.',
  '    // The original center is deliberately dominant to keep silhouettes readable.',
  '    vec4 blurred = vec4(0.0);',
  '    for (int i = 0; i < MAX_KERNEL_TAPS; i++)',
  '    {',
  '        if (float(i) >= uSampleCount) break;',
  '        float tapIndex = float(i);',
  '        vec2 grid = vec2(mod(tapIndex, 3.0) - 1.0, floor(tapIndex / 3.0) - 1.0);',
  '        float tapWeight = 0.05;',
  '        if (i == 4)',
  '        {',
  '            tapWeight = 0.44;',
  '        }',
  '        else if (grid.x == 0.0 || grid.y == 0.0)',
  '        {',
  '            tapWeight = 0.09;',
  '        }',
  '        vec2 offset = grid * (uBlurRadius * KERNEL_CORNER_RADIUS_SCALE * blurScale) / uDesignSize;',
  '        vec4 tap;',
  '        if (i == 4)',
  '        {',
  '            tap = source;',
  '        }',
  '        else',
  '        {',
  '            tap = boundedSampler(uMainSampler, outTexCoord + offset);',
  '        }',
  '        blurred += tap * tapWeight;',
  '    }',
  '',
  '    vec3 color = mix(source.rgb, blurred.rgb, blurMix);',
  '    float outerMix = uRadius <= 0.0',
  '        ? 1.0',
  '        : smoothstep(uRadius + uSoftness * 0.4, uRadius + uSoftness * 1.35, distancePx);',
  '    outerMix = clamp(outerMix * uAlpha, 0.0, 1.0);',
  '    float luminance = dot(color, vec3(0.299, 0.587, 0.114));',
  '    color = mix(color, vec3(luminance), outerMix * uDesaturate);',
  '    color *= 1.0 - outerMix * uDarken;',
  '',
  '    gl_FragColor = vec4(color, source.a);',
  '}',
].join('\n');

/**
 * Persistent controller for the world-camera focus pass. The camera filter list owns this
 * instance for the lifetime of the scene; effects only mutate its uniforms and active state.
 */
export class RadialFocusFilterController extends Phaser.Filters.Controller {
  private effectActive = false;
  private qualityEnabled = true;
  focusX = 0;
  focusY = 0;
  radiusPx = 0;
  alpha = 0;
  arenaX = 0;
  arenaY = 0;
  arenaWidth = 0;
  arenaHeight = 0;
  softnessPx = RADIAL_FOCUS_SOFTNESS_PX;
  blurRadiusPx = 30;
  sampleCount = RADIAL_FOCUS_KERNEL_TAP_COUNT;
  darken = RADIAL_FOCUS_DARKEN;
  desaturate = RADIAL_FOCUS_DESATURATE;

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    super(camera, RADIAL_FOCUS_RENDER_NODE);
    this.setPaddingOverride();
    this.active = false;
  }

  /** Keeps the quality controller's permission separate from the live effect state. */
  override setActive(value: boolean): this {
    this.qualityEnabled = value;
    this.active = value && this.effectActive;
    return this;
  }

  setFrame(frame: RadialFocusFrame | null, quality: RadialFocusQualityLevel): void {
    if (!frame) {
      this.effectActive = false;
      this.alpha = 0;
      this.active = false;
      return;
    }

    this.focusX = frame.focusX;
    this.focusY = frame.focusY;
    this.radiusPx = frame.radiusPx;
    this.alpha = Phaser.Math.Clamp(frame.alpha, 0, 1);
    this.arenaX = frame.arenaRect.x;
    this.arenaY = frame.arenaRect.y;
    this.arenaWidth = frame.arenaRect.width;
    this.arenaHeight = frame.arenaRect.height;
    const sampling = resolveRadialFocusSampling(quality);
    this.sampleCount = sampling.sampleCount;
    this.blurRadiusPx = sampling.blurRadiusPx;
    this.effectActive = sampling.filterActive && this.alpha > 0.01;
    this.active = this.qualityEnabled && this.effectActive;
  }
}

/** WebGL render node used by {@link RadialFocusFilterController}. */
export class RadialFocusRenderNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(RADIAL_FOCUS_RENDER_NODE, manager, undefined, RADIAL_FOCUS_FRAGMENT_SHADER);
  }

  setupUniforms(
    controller: Phaser.Filters.Controller,
    _drawingContext: Phaser.Renderer.WebGL.DrawingContext,
  ): void {
    const radial = controller as RadialFocusFilterController;
    const uniforms = this.programManager;

    uniforms.setUniform('uDesignSize', [GAME_WIDTH, GAME_HEIGHT]);
    uniforms.setUniform('uFocus', [radial.focusX, radial.focusY]);
    uniforms.setUniform('uArenaRect', [
      radial.arenaX,
      radial.arenaY,
      radial.arenaWidth,
      radial.arenaHeight,
    ]);
    uniforms.setUniform('uRadius', radial.radiusPx);
    uniforms.setUniform('uSoftness', radial.softnessPx);
    uniforms.setUniform('uAlpha', radial.alpha);
    uniforms.setUniform('uBlurRadius', radial.blurRadiusPx);
    uniforms.setUniform('uSampleCount', radial.sampleCount);
    uniforms.setUniform('uDarken', radial.darken);
    uniforms.setUniform('uDesaturate', radial.desaturate);
  }
}
