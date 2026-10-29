import type { Plugin } from 'vite';

export function publicDeploymentExclusions(): Promise<Set<string>>;
export function publicDeploymentFiles(): Promise<string[]>;
export function publicDeployment(): Plugin;
