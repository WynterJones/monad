#!/usr/bin/env node

/**
 * Release wrapper script
 * This allows npm scripts to execute the release.sh script
 */

const { spawn } = require('child_process');
const path = require('path');

// Get the release script path
const releaseScript = path.join(__dirname, 'release.sh');

// Pass through all command line arguments
const args = process.argv.slice(2);

// Execute the release script
const child = spawn('bash', [releaseScript, ...args], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')
});

child.on('exit', (code) => {
  process.exit(code);
});