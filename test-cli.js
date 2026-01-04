// Test script to run create-monad directly
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test the CLI by running it with --yes flag
const cliPath = path.join(__dirname, 'packages/create-monad/src/cli.ts');

try {
  console.log('Testing create-monad CLI...');
  console.log('CLI path:', cliPath);

  // Use tsx to run TypeScript directly if available, otherwise node --loader
  try {
    execSync(`npx tsx "${cliPath}" test-project --yes --no-install --no-git`, {
      cwd: __dirname + '/test-cli',
      stdio: 'inherit'
    });
  } catch (error) {
    console.log('tsx not available, trying ts-node...');
    execSync(`npx ts-node "${cliPath}" test-project --yes --no-install --no-git`, {
      cwd: __dirname + '/test-cli',
      stdio: 'inherit'
    });
  }
} catch (error) {
  console.error('Error testing CLI:', error.message);
}