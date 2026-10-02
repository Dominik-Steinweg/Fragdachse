import { describe, expect, it, vi } from 'vitest';
import { disposeShaderWarmupNode } from '../src/graphics/disposeShaderWarmupNode';

describe('temporary shader probe GPU ownership', () => {
  it.each([false, true])('releases only private buffers and VAOs (instanced: %s)', instanced => {
    const vao = { destroy: vi.fn() }, otherVao = { destroy: vi.fn() };
    const program = { destroy: vi.fn() }, sharedIndex = {}, vertex = {}, instances = {};
    const renderer = { glVAOWrappers: [vao, otherVao], deleteBuffer: vi.fn() };
    const node = { manager: { renderer }, programManager: { programs: { key: { vao, program } } },
      vertexBufferLayout: { buffer: vertex }, indexBuffer: sharedIndex,
      ...(instanced ? { instanceBufferLayout: { buffer: instances } } : {}),
    };
    disposeShaderWarmupNode(node as never);
    expect(vao.destroy).toHaveBeenCalledOnce(); expect(otherVao.destroy).not.toHaveBeenCalled();
    expect(renderer.glVAOWrappers).toEqual([otherVao]);
    expect(node.programManager.programs).toEqual({});
    expect(renderer.deleteBuffer.mock.calls).toEqual(instanced ? [[vertex], [instances]] : [[vertex]]);
    expect(program.destroy).not.toHaveBeenCalled();
  });
});
