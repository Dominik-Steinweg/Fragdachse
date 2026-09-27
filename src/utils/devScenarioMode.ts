// Set only by the isolated development entry, before importing the game.
let isolated = false;
export function enableDevScenarioMode(): void {
  if (!import.meta.env.DEV) throw new Error('Dev scenarios require the Vite development server.');
  isolated = true;
}
export function isDevScenarioMode(): boolean { return import.meta.env.DEV && isolated; }
