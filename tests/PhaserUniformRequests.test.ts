import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { installPhaserUniformRequests, UniformRequestMap } from '../src/graphics/PhaserUniformRequests';

describe('Phaser uniform request storage', () => {
  it('binds the same requests in insertion order, last value winning, without per-bind callbacks', () => {
    const require = createRequire(import.meta.url);
    const Program = require('../node_modules/phaser/src/renderer/webgl/wrappers/WebGLProgramWrapper.js');
    const PhaserMap = require('../node_modules/phaser/src/structs/Map.js');
    installPhaserUniformRequests(Program.prototype);
    const updateBindingsProgram = vi.fn();
    const program = Object.create(Program.prototype);
    Object.assign(program, { renderer: { glWrapper: { updateBindingsProgram } }, glState: { program: 'state' },
      uniformRequests: new PhaserMap() });
    // Context restoration fills Phaser's own map before any request arrives.
    program.uniformRequests.set('uRestored', 1);
    const processed: [string, unknown][] = [];
    program._processUniformRequest = function (name: string, value: unknown) { expect(this).toBe(program); processed.push([name, value]); };
    const bindSpy = vi.spyOn(program._processUniformRequest, 'bind');
    program.setUniform('uA', 2);
    program.setUniform('uB', [3, 4]);
    program.setUniform('uA', 5);
    expect(program.uniformRequests).toBeInstanceOf(UniformRequestMap);
    program.bind();
    expect(updateBindingsProgram).toHaveBeenCalledWith(program.glState);
    expect(processed).toEqual([['uRestored', 1], ['uA', 5], ['uB', [3, 4]]]);
    expect(program.uniformRequests.size).toBe(0);
    program.bind();
    expect(processed).toHaveLength(3);
    // The restoration path keeps using has/set on the replaced map.
    if (!program.uniformRequests.has('uC')) program.uniformRequests.set('uC', 6);
    program.setUniform('uD', 7);
    program.bind();
    expect(processed.slice(3)).toEqual([['uC', 6], ['uD', 7]]);
    expect(bindSpy).toHaveBeenCalledTimes(1);
    expect(updateBindingsProgram).toHaveBeenCalledTimes(3);
  });
});
