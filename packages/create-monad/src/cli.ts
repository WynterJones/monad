#!/usr/bin/env node

import { Command } from 'commander';
import { createMonadProject } from './index.js';

interface CliOptions {
  yes?: boolean;
  pm?: string;
  og?: boolean;
  lighthouse?: boolean;
  git?: boolean;
  install?: boolean;
  template?: string;
  force?: boolean;
}

const program = new Command();

program
  .name('create-monad')
  .description('Create a new Monad project')
  .version('1.0.0')
  .argument('[project-directory]', 'project directory name')
  .option('-y, --yes', 'skip prompts and use defaults')
  .option('--pm <package-manager>', 'package manager to use (npm|pnpm|yarn|bun)')
  .option('--og', 'enable OG image generation')
  .option('--no-og', 'disable OG image generation')
  .option('--lighthouse', 'enable Lighthouse CI')
  .option('--no-lighthouse', 'disable Lighthouse CI')
  .option('--git', 'initialize git repository')
  .option('--no-git', 'skip git initialization')
  .option('--install', 'install dependencies')
  .option('--no-install', 'skip dependency installation')
  .option('--template <template>', 'template to use (currently only: marketing-site)', 'marketing-site')
  .option('--force', 'overwrite existing directory without asking')
  .action(async (projectDirectory: string, options: CliOptions) => {
    try {
      await createMonadProject(projectDirectory, options);
    } catch (error) {
      console.error('Error creating Monad project:', error);
      process.exit(1);
    }
  });

program.parse();