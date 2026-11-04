import os from 'node:os';
import path from 'node:path';

export function getHomeDir(): string {
  if (process.env.GONX_HOME && process.env.GONX_HOME.trim().length > 0) {
    return path.resolve(process.env.GONX_HOME);
  }
  return os.homedir();
}

export function getProjectRoot(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return path.resolve(explicit);
  }
  return process.cwd();
}

