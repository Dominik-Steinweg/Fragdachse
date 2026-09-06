import { tracerBounceDebug } from '../projectile/ProjectileBounceDiagnostics';
export { tracerBounceDebug };

if (typeof window !== 'undefined') {
  const mode = new URLSearchParams(window.location.search).get('tracerDebug');
  tracerBounceDebug.centerline = mode === 'line' || mode === 'pin';
  tracerBounceDebug.pinBounceWake = mode === 'pin';
  Object.assign(window, { fragdachseTracerDebug: tracerBounceDebug });
}
