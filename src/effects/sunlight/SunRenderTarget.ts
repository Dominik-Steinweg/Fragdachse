import * as Phaser from 'phaser';

let nextId = 0;
const RESTORE_BLEND = {blend:{enabled:true}};
/** World-owned ShaderQuad resources, including Phaser 4.2.1's orphaned nodes. */
export function ownSunShader(shader: Phaser.GameObjects.Shader, name: string): void {
  const node = shader.renderNode, renderer = node.renderer;
  // ShaderQuad.setupTextures allocates an array on every draw in 4.2.1.
  const textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[] = [];
  node.setupTextures = object => {
    textures.length = object.textures.length;
    for (let i=0; i<textures.length; i++) textures[i] = object.textures[i].get().source.glTexture!;
    return textures;
  };
  shader.once('destroy', () => {
    renderer.renderNodes.finishBatch();
    // Phaser 4.2.1 WebGLProgramWrapper.destroy disables attributes on the CURRENT
    // VAO, even if it belongs to an unrelated sprite batch. Never damage that VAO.
    // Phaser accepts null (unbind); its published type accidentally omits it.
    renderer.glWrapper.update({vao:null} as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters);
    for (const suite of Object.values(node.programManager.programs)) {
      Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
    }
    node.programManager.programs = {};
    renderer.deleteBuffer(node.vertexBufferLayout.buffer);
    const programs = renderer.shaderProgramFactory.programs as Record<string, Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper>;
    for (const key of Object.keys(programs)) if (key === name || key.startsWith(`${name}_`)) {
      renderer.deleteProgram(programs[key]); delete programs[key];
    }
  });
}
export function sunShaderName(kind: string): string { return `WorldSun${kind}${nextId++}`; }

export class SunRenderTarget {
  readonly shader: Phaser.GameObjects.Shader;
  constructor(scene: Phaser.Scene, kind: string, fragmentSource: string,
    setupUniforms: (set: (name: string, value: unknown) => void) => void,
    textures: string[] | Phaser.Textures.Texture[] = ['__DEFAULT']) {
    const name = sunShaderName(kind);
    this.shader = new Phaser.GameObjects.Shader(scene, { name, shaderName: name, fragmentSource, setupUniforms },0,0,3,3,textures);
    ownSunShader(this.shader,name);
    try {
      // A non-power-of-two initial size selects CLAMP_TO_EDGE in Phaser.
      // Phaser resets sampling on resize; draw() restores the finite-field contract.
      this.shader.setRenderToTexture(name);
      const camera=this.shader.drawingContext!.camera;
      this.shader.once('destroy',()=>camera?.destroy());
      this.shader.drawingContext!.state.blend!.enabled = false;
      this.shader.texture!.setFilter(Phaser.Textures.FilterMode.LINEAR);
    } catch(error) { this.shader.destroy(); throw error; }
  }
  draw(width: number, height: number): void {
    const shader=this.shader, renderer=shader.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    shader.setSize(width,height);
    try {
      shader.renderWebGLStep(renderer,shader,shader.drawingContext!);
      // The actual texture resize happens inside renderWebGLStep, not setSize.
      clampSunRenderTexture(renderer,shader.glTexture!);
    }
    finally {
      // DrawingContext.setBlendMode writes 'enable', but WebGLGlobalWrapper
      // consumes 'enabled' in 4.2.1. Do not leave later scene draws unblended.
      renderer.glWrapper.update(RESTORE_BLEND);
    }
  }
  destroy(): void { this.shader.destroy(); }
}

/** Phaser 4.2.1 resets POT render targets to REPEAT (and may select mipmaps).
 * Finite world fields and reduced composites must interpolate only adjacent
 * texels, including after quality/viewport resize and context restoration. */
export function clampSunRenderTexture(renderer:Phaser.Renderer.WebGL.WebGLRenderer,
  texture:Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper):void {
  const gl=renderer.gl;
  if(texture.wrapS===gl.CLAMP_TO_EDGE&&texture.wrapT===gl.CLAMP_TO_EDGE
    &&texture.minFilter===gl.LINEAR&&texture.magFilter===gl.LINEAR)return;
  renderer.glTextureUnits.bind(texture,0);
  texture.wrapS=texture.wrapT=gl.CLAMP_TO_EDGE;
  texture.minFilter=texture.magFilter=gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,texture.wrapS);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,texture.wrapT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,texture.minFilter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,texture.magFilter);
}
