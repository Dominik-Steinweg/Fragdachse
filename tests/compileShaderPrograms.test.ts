import { describe, expect, it } from 'vitest';
import { beginShaderPrograms, compileShaderPrograms } from '../src/graphics/compileShaderPrograms';

describe('grouped shader links', () => {
  it('keeps the rendering config unchanged between submission and an idempotent completion barrier', () => {
    const config={skipUnreadyShaders:false};let completions=0;
    const program={compiling:true,_completeProgram(){completions++;this.compiling=false;}};
    const renderer={game:{config},shaderProgramFactory:{getShaderProgram(){return program;}}};
    const finish=beginShaderPrograms(renderer as never,[{currentConfig:{}}] as never);
    expect(config.skipUnreadyShaders).toBe(false);expect(completions).toBe(0);
    finish();finish();expect(completions).toBe(1);expect(program.compiling).toBe(false);
  });
  it('submits every independent program before blocking for completion and leaves no pending draw', () => {
    const events: string[] = [], config = { skipUnreadyShaders: false };
    const programs = ['a', 'b'].map(name => ({ compiling: true, _completeProgram() {
      expect(config.skipUnreadyShaders).toBe(false); events.push(`complete:${name}`); this.compiling=false;
    } }));
    const renderer = { game: { config }, shaderProgramFactory: { getShaderProgram(base: number) {
      expect(config.skipUnreadyShaders).toBe(true); events.push(`link:${base}`); return programs[base];
    } } };
    compileShaderPrograms(renderer as never, [0,1,0].map(base => ({ currentConfig: { base } })) as never);
    expect(events).toEqual(['link:0','link:1','link:0','complete:a','complete:b']);
    expect(programs.every(p => !p.compiling)).toBe(true);
    expect(config.skipUnreadyShaders).toBe(false);
  });
  it('restores configuration and completes already submitted work when construction fails', () => {
    const config={skipUnreadyShaders:false};let completed=false;
    const renderer={game:{config},shaderProgramFactory:{getShaderProgram(base:number){
      if(base)throw Error('construction');return {compiling:true,_completeProgram(){completed=true;}};
    }}};
    expect(()=>compileShaderPrograms(renderer as never,[0,1].map(base=>({currentConfig:{base}})) as never)).toThrow('construction');
    expect(config.skipUnreadyShaders).toBe(false);expect(completed).toBe(true);
  });
  it('removes failed speculative links without poisoning the normal renderer retry',()=>{
    const program={compiling:true,_completeProgram(){throw Error('compile');}},other={};
    const cache:Record<string,unknown>={pending:program,ready:other};
    const renderer={game:{config:{skipUnreadyShaders:false}},glWrapper:{update(){}},deleteProgram(){},
      shaderProgramFactory:{programs:cache,getShaderProgram(){return program;}}};
    const finish=beginShaderPrograms(renderer as never,[{currentConfig:{}}] as never);
    expect(finish).toThrow('compile');expect(cache).toEqual({ready:other});expect(finish).not.toThrow();
  });
});
