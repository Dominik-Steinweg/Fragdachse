interface TimerExtension {
  TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number; QUERY_RESULT_AVAILABLE_EXT: number; QUERY_RESULT_EXT: number;
  createQueryEXT(): WebGLQuery | null; deleteQueryEXT(q: WebGLQuery): void;
  beginQueryEXT(target: number, q: WebGLQuery): void; endQueryEXT(target: number): void;
  getQueryObjectEXT(q: WebGLQuery, key: number): number | boolean;
}
/** Optional diagnostics. Queries are bounded, asynchronous, and never gate a frame. */
export class FogGpuTimer {
  private readonly extension: TimerExtension | null;
  private readonly gl2: WebGL2RenderingContext | null;
  private readonly pending: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  ms: number | null = null;
  sample = 0;
  constructor(private readonly gl: WebGLRenderingContext) {
    this.gl2 = 'createQuery' in gl ? gl as WebGL2RenderingContext : null;
    this.extension = gl.getExtension(this.gl2 ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query') as TimerExtension | null;
  }
  get supported(): boolean { return this.extension !== null; }
  begin(): void {
    const e = this.extension; if (!e || this.current) return;
    if (this.gl.getParameter(e.GPU_DISJOINT_EXT)) { this.clear(); this.ms = null; return; }
    while (this.pending.length) {
      const q = this.pending[0];
      const available = this.gl2 ? this.gl2.getQueryParameter(q, this.gl2.QUERY_RESULT_AVAILABLE) : e.getQueryObjectEXT(q, e.QUERY_RESULT_AVAILABLE_EXT);
      if (!available) break;
      const ns = this.gl2 ? this.gl2.getQueryParameter(q, this.gl2.QUERY_RESULT) : e.getQueryObjectEXT(q, e.QUERY_RESULT_EXT);
      this.pending.shift(); this.remove(q);
      if (typeof ns === 'number' && Number.isFinite(ns)) { this.ms = ns / 1e6; this.sample++; }
    }
    if (this.pending.length >= 8) return;
    this.current = this.gl2 ? this.gl2.createQuery() : e.createQueryEXT();
    if (this.current) {
      if (this.gl2) this.gl2.beginQuery(e.TIME_ELAPSED_EXT, this.current);
      else e.beginQueryEXT(e.TIME_ELAPSED_EXT, this.current);
    }
  }
  end(): void {
    if (!this.current || !this.extension) return;
    if (this.gl2) this.gl2.endQuery(this.extension.TIME_ELAPSED_EXT);
    else this.extension.endQueryEXT(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.current); this.current = null;
  }
  private remove(q: WebGLQuery): void { if (this.gl2) this.gl2.deleteQuery(q); else this.extension?.deleteQueryEXT(q); }
  private clear(): void { for (const q of this.pending) this.remove(q); this.pending.length = 0; }
  destroy(): void { this.end(); this.clear(); }
}
