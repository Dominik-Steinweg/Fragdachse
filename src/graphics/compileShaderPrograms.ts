import type * as Phaser from 'phaser';

/** Submit independent links before requesting any link status. All programs are
 * complete before returning: ordinary rendering and reveal never skip a draw.
 * The config flag is scoped to synchronous factory calls, not a rendered frame.
 */
export function compileShaderPrograms(
  renderer: Phaser.Renderer.WebGL.WebGLRenderer,
  managers: readonly Phaser.Renderer.WebGL.ProgramManager[],
): void {
  beginShaderPrograms(renderer, managers)();
}

/** Boot-only split phase. The caller MUST finish before any consumer can render,
 * and on cancellation. This overlaps links with unrelated CPU preparation.
 */
export function beginShaderPrograms(
  renderer: Phaser.Renderer.WebGL.WebGLRenderer,
  managers: readonly Phaser.Renderer.WebGL.ProgramManager[],
): () => void {
  // Runtime config is mutable; Phaser exposes it as readonly in declarations.
  const config = renderer.game.config as { skipUnreadyShaders: boolean };
  const previous = config.skipUnreadyShaders;
  const programs = new Set<Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper>();
  const finish = (): void => {
    // On context loss Phaser recreates the cached wrappers on restoration.
    if (renderer.gl?.isContextLost()) { programs.clear(); return; }
    let failure: unknown;
    for (const program of programs) if (program.compiling) {
      try { (program as unknown as { _completeProgram(): void })._completeProgram(); }
      catch (error) {
        failure ??= error;
        // No suite/VAO can have been published for a still-compiling program.
        // Remove a failed speculative link so the ordinary capability/fallback
        // path can retry normally rather than seeing a permanently pending key.
        renderer.glWrapper.update({vao:null} as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters);
        const cache=renderer.shaderProgramFactory.programs as Record<string,typeof program>;
        for(const key of Object.keys(cache))if(cache[key]===program)delete cache[key];
        renderer.deleteProgram(program);
      }
    }
    programs.clear();
    if (failure) throw failure;
  };
  try {
    config.skipUnreadyShaders = true;
    for (const manager of managers) {
      const c = manager.currentConfig as {
        base: Parameters<typeof renderer.shaderProgramFactory.getShaderProgram>[0];
        additions: Parameters<typeof renderer.shaderProgramFactory.getShaderProgram>[1];
        features: Parameters<typeof renderer.shaderProgramFactory.getShaderProgram>[2];
      };
      programs.add(renderer.shaderProgramFactory.getShaderProgram(c.base, c.additions, c.features));
    }
  } catch (error) {
    config.skipUnreadyShaders = previous;
    finish();
    throw error;
  } finally {
    config.skipUnreadyShaders = previous;
    // Phaser 4.2.1's public polling path deliberately skips pending programs.
    // Its completion method provides the same blocking/error behavior as normal
    // createResource(), after the driver has received every independent link.
  }
  return finish;
}
