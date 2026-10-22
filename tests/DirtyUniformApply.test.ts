import { describe, expect, it } from 'vitest';
import { installDirtyUniformApply, type DirtyUniformSetter } from '../src/graphics/DirtyUniformApply';

type Fake = { uniforms: Record<string, unknown>; setUniform(name: string, value: unknown): void; applyUniforms(program: object): void };

function manager(): { m: Fake; set: DirtyUniformSetter } {
  const m: Fake = {
    uniforms: {},
    setUniform(name, value) { this.uniforms[name] = value; },
    applyUniforms() { throw new Error('replaced'); },
  };
  return { m, set: installDirtyUniformApply(m as never, {} as never) };
}

function program() {
  const received: string[] = [];
  return { received, setUniform(name: string) { received.push(name); } };
}

describe('installDirtyUniformApply', () => {
  it('forwards everything first, then only owned uniforms written since the previous apply', () => {
    const { m, set } = manager(), p = program();
    m.setUniform('uProjection', 1); set('uShared', 1); set('uChunk', 1);
    m.applyUniforms(p);
    expect(p.received).toEqual(['uProjection', 'uShared', 'uChunk']);
    p.received.length = 0;
    set('uChunk', 2);
    m.applyUniforms(p);
    // Base uniforms written past the setter keep Phaser's forward-every-time behaviour.
    expect(p.received).toEqual(['uProjection', 'uChunk']);
  });

  it('forwards everything again when another manager or program came in between', () => {
    const a = manager(), b = manager(), p = program(), q = program();
    a.set('uShared', 1); a.m.applyUniforms(p);
    b.set('uShared', 2); b.m.applyUniforms(p);
    p.received.length = 0;
    a.set('uChunk', 3); a.m.applyUniforms(p);
    expect(p.received).toEqual(['uShared', 'uChunk']);
    a.m.applyUniforms(q);
    p.received.length = 0;
    a.m.applyUniforms(p);
    expect(p.received).toEqual(['uShared', 'uChunk']);
  });
});
