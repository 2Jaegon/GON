import path from "node:path";
import fs from "node:fs";

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function isWindowsReservedName(fileName: string): boolean {
  return WINDOWS_RESERVED_NAMES.test(fileName);
}

export function isPathInside(parentDir: string, targetPath: string): boolean {
  const resolvedParent = path.resolve(parentDir);
  const resolvedTarget = path.resolve(targetPath);

  // Check if target is equal to parent or a child of parent
  if (resolvedParent === resolvedTarget) {
    return true;
  }

  const relative = path.relative(resolvedParent, resolvedTarget);
  // If relative starts with '..' or is an absolute drive root on Windows, it's outside
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }

  // Prevent Windows reserved device names in components
  const parts = relative.split(/[\\/]/);
  for (const part of parts) {
    if (isWindowsReservedName(part)) {
      return false;
    }
  }

  return true;
}

export function assertSafePath(parentDir: string, targetPath: string): string {
  if (!isPathInside(parentDir, targetPath)) {
    throw new Error(`Security Violation: Target path '${targetPath}' is outside allowed parent '${parentDir}'`);
  }
  return path.resolve(targetPath);
}

