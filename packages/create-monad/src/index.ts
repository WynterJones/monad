import fs from 'fs-extra';
import path from 'path';
import prompts from 'prompts';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { detectPackageManager } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CreateOptions {
  yes?: boolean;
  pm?: string;
  og?: boolean;
  lighthouse?: boolean;
  git?: boolean;
  install?: boolean;
  template?: string;
  force?: boolean;
  siteUrl?: string;
}

export async function createMonadProject(projectDirectory?: string, options: CreateOptions = {}) {
  console.log(chalk.cyan('🚀 Create Monad'));
  console.log();

  // Resolve project directory
  let targetDir = projectDirectory || '.';
  if (targetDir === '.') {
    targetDir = process.cwd();
  } else {
    targetDir = path.resolve(projectDirectory || '.');
  }

  const projectName = path.basename(targetDir);

  // Gather configuration through prompts or flags
  const config = await gatherConfiguration(projectName, targetDir, options);

  console.log();
  console.log(chalk.blue('📋 Configuration:'));
  console.log(`  Project: ${chalk.white(config.projectName)}`);
  console.log(`  Directory: ${chalk.white(config.targetDir)}`);
  console.log(`  Site URL: ${chalk.white(config.siteUrl)}`);
  console.log(`  OG Images: ${config.enableOg ? chalk.green('✓') : chalk.gray('✗')}`);
  console.log(`  Lighthouse CI: ${config.enableLighthouse ? chalk.green('✓') : chalk.gray('✗')}`);
  console.log(`  Package Manager: ${chalk.white(config.packageManager)}`);
  console.log(`  Git Repository: ${config.initGit ? chalk.green('✓') : chalk.gray('✗')}`);
  console.log(`  Install Dependencies: ${config.installDeps ? chalk.green('✓') : chalk.gray('✗')}`);
  console.log();

  // Check if directory exists and handle overwrite
  await handleExistingDirectory(config.targetDir, options.force);

  // Copy template files
  console.log(chalk.blue('📂 Copying template files...'));
  await copyTemplate(config);

  // Process template files (replace placeholders)
  console.log(chalk.blue('🔄 Processing template...'));
  await processTemplateFiles(config);

  // Initialize git if requested
  if (config.initGit) {
    console.log(chalk.blue('📦 Initializing git repository...'));
    await initializeGit(config.targetDir);
  }

  // Install dependencies if requested
  if (config.installDeps) {
    console.log(chalk.blue('📦 Installing dependencies...'));
    await installDependencies(config.targetDir, config.packageManager);
  }

  // Print next steps
  printNextSteps(config);
}

interface ProjectConfig {
  projectName: string;
  targetDir: string;
  siteUrl: string;
  enableOg: boolean;
  enableLighthouse: boolean;
  packageManager: string;
  initGit: boolean;
  installDeps: boolean;
  template: string;
}

async function gatherConfiguration(
  projectName: string,
  targetDir: string,
  options: CreateOptions
): Promise<ProjectConfig> {
  if (options.yes) {
    return {
      projectName,
      targetDir,
      siteUrl: 'https://example.com',
      enableOg: options.og ?? false,
      enableLighthouse: options.lighthouse ?? false,
      packageManager: options.pm || detectPackageManager(),
      initGit: options.git ?? true,
      installDeps: options.install ?? true,
      template: options.template || 'marketing-site'
    };
  }

  const questions: any[] = [];

  if (!options.hasOwnProperty('siteUrl')) {
    questions.push({
      type: 'text',
      name: 'siteUrl',
      message: 'Site URL (required for sitemap/canonical):',
      initial: 'https://example.com',
      validate: (value: string) => value.trim().length > 0 || 'Site URL is required'
    });
  }

  if (!options.hasOwnProperty('og')) {
    questions.push({
      type: 'confirm',
      name: 'enableOg',
      message: 'Enable OG image generation?',
      initial: false
    });
  }

  if (!options.hasOwnProperty('lighthouse')) {
    questions.push({
      type: 'confirm',
      name: 'enableLighthouse',
      message: 'Enable Lighthouse CI?',
      initial: false
    });
  }

  if (!options.pm) {
    const detected = detectPackageManager();
    questions.push({
      type: 'select',
      name: 'packageManager',
      message: 'Package manager:',
      choices: [
        { title: `${detected} (detected)`, value: detected },
        ...['npm', 'pnpm', 'yarn', 'bun']
          .filter(pm => pm !== detected)
          .map(pm => ({ title: pm, value: pm }))
      ]
    });
  }

  if (!options.hasOwnProperty('git')) {
    questions.push({
      type: 'confirm',
      name: 'initGit',
      message: 'Initialize git repository?',
      initial: true
    });
  }

  if (!options.hasOwnProperty('install')) {
    questions.push({
      type: 'confirm',
      name: 'installDeps',
      message: 'Install dependencies now?',
      initial: true
    });
  }

  const answers = await prompts(questions);

  return {
    projectName,
    targetDir,
    siteUrl: options.siteUrl || answers.siteUrl,
    enableOg: options.og ?? answers.enableOg,
    enableLighthouse: options.lighthouse ?? answers.enableLighthouse,
    packageManager: options.pm || answers.packageManager || detectPackageManager(),
    initGit: options.git ?? answers.initGit,
    installDeps: options.install ?? answers.installDeps,
    template: options.template || 'marketing-site'
  };
}

async function handleExistingDirectory(targetDir: string, force?: boolean) {
  if (await fs.pathExists(targetDir)) {
    const files = await fs.readdir(targetDir);
    if (files.length > 0) {
      if (force) {
        console.log(chalk.yellow('⚠️  Clearing existing directory...'));
        await fs.emptyDir(targetDir);
        return;
      }

      const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: `Directory ${chalk.cyan(targetDir)} is not empty. What would you like to do?`,
        choices: [
          { title: 'Overwrite', value: 'overwrite' },
          { title: 'Cancel', value: 'cancel' }
        ]
      });

      if (action === 'cancel') {
        console.log(chalk.red('Cancelled'));
        process.exit(0);
      }

      if (action === 'overwrite') {
        console.log(chalk.yellow('⚠️  Clearing existing directory...'));
        await fs.emptyDir(targetDir);
      }
    }
  }
}

async function copyTemplate(config: ProjectConfig) {
  const templateDir = path.join(__dirname, '..', 'templates', config.template);

  if (!(await fs.pathExists(templateDir))) {
    throw new Error(`Template "${config.template}" not found`);
  }

  await fs.ensureDir(config.targetDir);
  await fs.copy(templateDir, config.targetDir);
}

async function processTemplateFiles(config: ProjectConfig) {
  const filesToProcess = [
    'package.json',
    'vite.config.ts',
    'README.md',
    'lighthouserc.cjs',
    'pages/index.html',
    'pages/about.html',
    'pages/404.html'
  ];

  for (const file of filesToProcess) {
    const filePath = path.join(config.targetDir, file);

    if (await fs.pathExists(filePath)) {
      let content = await fs.readFile(filePath, 'utf8');

      // Replace placeholders
      content = content.replace(/__PROJECT_NAME__/g, config.projectName);
      content = content.replace(/__SITE_URL__/g, config.siteUrl);

      // Handle conditional features
      if (config.enableOg) {
        content = content.replace(/__ENABLE_OG__/g, '');
        content = content.replace(/__OG_DEPS__/g, ',\\n    "og-gen": "^1.0.0"');
      } else {
        content = content.replace(/__ENABLE_OG__.*/g, '');
        content = content.replace(/__OG_DEPS__/g, '');
      }

      if (config.enableLighthouse) {
        content = content.replace(/__ENABLE_LHCI__/g, '');
        content = content.replace(/__LHCI_SCRIPT__/g, ',\\n    "lhci": "lhci autorun --collect.staticDistDir=dist --upload.target=filesystem --upload.outputDir=dist/__monad/lighthouse"');
        content = content.replace(/__LHCI_DEPS__/g, ',\\n    "@lhci/cli": "^0.13.0"');
      } else {
        content = content.replace(/__ENABLE_LHCI__.*/g, '');
        content = content.replace(/__LHCI_SCRIPT__/g, '');
        content = content.replace(/__LHCI_DEPS__/g, '');
      }

      await fs.writeFile(filePath, content, 'utf8');
    }
  }

  // Remove lighthouse config if not enabled
  if (!config.enableLighthouse) {
    const lighthousePath = path.join(config.targetDir, 'lighthouserc.cjs');
    if (await fs.pathExists(lighthousePath)) {
      await fs.remove(lighthousePath);
    }
  }
}

async function initializeGit(targetDir: string) {
  try {
    execSync('git init', { cwd: targetDir, stdio: 'pipe' });

    // Create .gitignore if it doesn't exist
    const gitignorePath = path.join(targetDir, '.gitignore');
    if (!(await fs.pathExists(gitignorePath))) {
      const gitignoreContent = `node_modules/
dist/
.env
.env.local
.env.*.local
*.log
.DS_Store
`;
      await fs.writeFile(gitignorePath, gitignoreContent, 'utf8');
    }

    execSync('git add -A', { cwd: targetDir, stdio: 'pipe' });
    execSync('git commit -m "Init Monad site 🚀\\n\\n🤖 Generated with Claude Code\\n\\nCo-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"', {
      cwd: targetDir,
      stdio: 'pipe'
    });

    console.log(chalk.green('✓ Git repository initialized'));
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to initialize git repository'));
  }
}

async function installDependencies(targetDir: string, packageManager: string) {
  try {
    const commands = {
      npm: 'npm install',
      pnpm: 'pnpm install',
      yarn: 'yarn',
      bun: 'bun install'
    };

    const command = commands[packageManager as keyof typeof commands];
    if (!command) {
      throw new Error(`Unknown package manager: ${packageManager}`);
    }

    console.log(chalk.gray(`Running: ${command}`));
    execSync(command, { cwd: targetDir, stdio: 'inherit' });
    console.log(chalk.green('✓ Dependencies installed'));
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to install dependencies'));
    console.log(chalk.gray('You can install them manually later'));
  }
}

function printNextSteps(config: ProjectConfig) {
  console.log();
  console.log(chalk.green('🎉 Project created successfully!'));
  console.log();
  console.log(chalk.blue('📖 Next steps:'));

  if (path.resolve(config.targetDir) !== process.cwd()) {
    console.log(`  ${chalk.cyan('cd')} ${path.relative(process.cwd(), config.targetDir)}`);
  }

  if (!config.installDeps) {
    const commands = {
      npm: 'npm install',
      pnpm: 'pnpm install',
      yarn: 'yarn',
      bun: 'bun install'
    };
    console.log(`  ${chalk.cyan(commands[config.packageManager as keyof typeof commands])}`);
  }

  const devCommands = {
    npm: 'npm run dev',
    pnpm: 'pnpm dev',
    yarn: 'yarn dev',
    bun: 'bun run dev'
  };
  console.log(`  ${chalk.cyan(devCommands[config.packageManager as keyof typeof devCommands])}`);

  console.log();
  console.log(chalk.blue('📁 Project structure:'));
  console.log(`  ${chalk.cyan('pages/')} - Your site pages`);
  console.log(`  ${chalk.cyan('partials/')} - Reusable components`);
  console.log(`  ${chalk.cyan('src/')} - TypeScript and CSS`);
  console.log(`  ${chalk.cyan('vite.config.ts')} - Monad configuration`);
  console.log();
  console.log(chalk.blue('🔧 Build commands:'));

  const buildCommands = {
    npm: 'npm run build',
    pnpm: 'pnpm build',
    yarn: 'yarn build',
    bun: 'bun run build'
  };
  console.log(`  ${chalk.cyan(buildCommands[config.packageManager as keyof typeof buildCommands])} - Build for production`);

  const previewCommands = {
    npm: 'npm run preview',
    pnpm: 'pnpm preview',
    yarn: 'yarn preview',
    bun: 'bun run preview'
  };
  console.log(`  ${chalk.cyan(previewCommands[config.packageManager as keyof typeof previewCommands])} - Preview production build`);

  console.log();
  console.log(`  ${chalk.cyan('dist/__monad/report.html')} - Build report (after build)`);

  if (config.enableLighthouse) {
    const lhciCommands = {
      npm: 'npm run lhci',
      pnpm: 'pnpm lhci',
      yarn: 'yarn lhci',
      bun: 'bun run lhci'
    };
    console.log(`  ${chalk.cyan(lhciCommands[config.packageManager as keyof typeof lhciCommands])} - Run Lighthouse CI`);
  }

  console.log();
  console.log(chalk.gray('Happy building! 🚀'));
}