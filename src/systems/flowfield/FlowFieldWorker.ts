/**
 * Worker-Entry. Bewusst duenn: Der gesamte Zustand liegt in {@link FlowFieldEngine}, damit dieselbe
 * Logik im Fallback und in Tests ohne Worker laeuft.
 *
 * Der Worker-Global wird lokal typisiert statt ueber `"WebWorker"` in `tsconfig.json`: Diese Lib
 * kollidiert mit `"DOM"` (beide deklarieren `self`, `postMessage`, `addEventListener`), und
 * `tsconfig.json` deckt mit `include: ["src"]` auch diese Datei ab.
 */
import { FlowFieldEngine } from './FlowFieldEngine';
import {
  FLOW_FIELD_PROTOCOL_VERSION,
  collectResultTransferables,
  type FlowFieldRequest,
} from './FlowFieldProtocol';

interface FlowFieldWorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: FlowFieldRequest }) => void) | null;
}

const scope = globalThis as unknown as FlowFieldWorkerScope;
const engine = new FlowFieldEngine();

scope.onmessage = (event: { data: FlowFieldRequest }): void => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      if (request.protocolVersion !== FLOW_FIELD_PROTOCOL_VERSION) {
        scope.postMessage({
          type: 'error',
          protocolVersion: FLOW_FIELD_PROTOCOL_VERSION,
          message: `protocol mismatch: host ${request.protocolVersion}, worker ${FLOW_FIELD_PROTOCOL_VERSION}`,
        });
        return;
      }
      engine.init(request);
      return;
    }
    const result = engine.runJob(request);
    scope.postMessage(result, collectResultTransferables(result));
  } catch (error) {
    scope.postMessage({
      type: 'error',
      protocolVersion: FLOW_FIELD_PROTOCOL_VERSION,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
