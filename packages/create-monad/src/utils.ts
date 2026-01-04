import { execSync } from 'child_process';
import fs from 'fs';

/**
 * Detect the package manager being used in the current environment
 */
export function detectPackageManager(): string {
  // Check for lockfiles
  try {

    if (fs.existsSync('pnpm-lock.yaml')) return 'pnpm';
    if (fs.existsSync('yarn.lock')) return 'yarn';
    if (fs.existsSync('bun.lockb')) return 'bun';
    if (fs.existsSync('package-lock.json')) return 'npm';
  } catch (error) {
    // Ignore error and continue to next detection method
  }

  // Check npm_config_user_agent
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.includes('pnpm')) return 'pnpm';
    if (userAgent.includes('yarn')) return 'yarn';
    if (userAgent.includes('bun')) return 'bun';
    if (userAgent.includes('npm')) return 'npm';
  }

  // Check which package managers are available
  try {
    execSync('pnpm --version', { stdio: 'pipe' });
    return 'pnpm';
  } catch (error) {
    // pnpm not available
  }

  try {
    execSync('yarn --version', { stdio: 'pipe' });
    return 'yarn';
  } catch (error) {
    // yarn not available
  }

  try {
    execSync('bun --version', { stdio: 'pipe' });
    return 'bun';
  } catch (error) {
    // bun not available
  }

  // Default to npm as it's bundled with Node.js
  return 'npm';
}