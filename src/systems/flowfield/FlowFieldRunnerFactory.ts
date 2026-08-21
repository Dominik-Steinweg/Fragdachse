/**
 * Auswahl des Ausfuehrungssubstrats. Nur diese Datei zieht `WorkerFlowFieldRunner` - und damit den
 * Worker-Entry - in den Graphen; ausserhalb der Produktionsverdrahtung wird sie nicht importiert.
 * Deshalb laedt Vitest den Worker-Entry nie, obwohl der Import hier statisch ist (Vite muss
 * `new Worker(new URL(...))` statisch sehen, um den Worker-Chunk zu bundeln).
 */
import { InlineFlowFieldRunner, type FlowFieldRunner } from './FlowFieldRunner';
import { WorkerFlowFieldRunner } from './WorkerFlowFieldRunner';

export function createFlowFieldRunner(): FlowFieldRunner {
  if (typeof Worker === 'undefined') return new InlineFlowFieldRunner();
  try {
    return new WorkerFlowFieldRunner();
  } catch {
    return new InlineFlowFieldRunner();
  }
}
