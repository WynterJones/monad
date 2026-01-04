# @wynterai/create-monad

Create new Monad projects from templates with a single command.

## Quick Start

```bash
# Create a new project
npx @wynterai/create-monad my-site

# Or in the current directory
npx @wynterai/create-monad .

# Skip prompts and use defaults
npx @wynterai/create-monad my-site --yes
```

## Options

### Project Configuration

- `[project-directory]` - Project directory name (default: current directory)
- `-y, --yes` - Skip prompts and use defaults
- `--template <template>` - Template to use (currently only: `marketing-site`)

### Site Configuration

- `--og` / `--no-og` - Enable/disable OG image generation
- `--lighthouse` / `--no-lighthouse` - Enable/disable Lighthouse CI

### Package Management

- `--pm <manager>` - Package manager to use (`npm`|`pnpm`|`yarn`|`bun`)
- `--install` / `--no-install` - Install/skip dependency installation

### Repository Setup

- `--git` / `--no-git` - Initialize/skip git repository
- `--force` - Overwrite existing directory without asking

## Examples

### Interactive Setup

```bash
npx @wynterai/create-monad my-landing-page
```

This will prompt you for:
- Site URL (required for sitemap/canonical)
- Enable OG image generation? (y/n)
- Enable Lighthouse CI? (y/n)
- Package manager (auto-detected)
- Initialize git repository? (y/n)
- Install dependencies now? (y/n)

### Quick Setup with Defaults

```bash
npx @wynterai/create-monad my-site --yes
```

Uses sensible defaults:
- Site URL: `https://example.com`
- OG images: disabled
- Lighthouse CI: disabled
- Package manager: auto-detected
- Git repository: enabled
- Install dependencies: enabled

### Custom Configuration

```bash
npx @wynterai/create-monad my-site \\
  --og \\
  --lighthouse \\
  --pm pnpm \\
  --no-git \\
  --no-install
```

### Development Site

```bash
npx @wynterai/create-monad dev-site \\
  --yes \\
  --no-og \\
  --no-lighthouse \\
  --no-install
```

## Templates

### marketing-site (default)

A complete marketing site template with:

- **Pages**: Home, About, 404
- **Partials**: Header, Footer, Feature Cards, CTA Bands
- **Styling**: Modern CSS with dark theme
- **SEO**: Meta tags, sitemaps, robots.txt
- **Performance**: Image optimization, minification
- **Development**: Hot reload, TypeScript support

## Project Structure

After creation, your project will have:

```
my-site/
├── pages/          # Site pages (index.html, about.html, 404.html)
├── partials/       # Reusable components
├── src/           # TypeScript and CSS (entry.ts, styles.css)
├── public/        # Static assets (favicon.svg)
├── vite.config.ts # Monad configuration
├── package.json   # Dependencies and scripts
├── tsconfig.json  # TypeScript configuration
└── README.md      # Project documentation
```

### Optional Files (based on options)

- `lighthouserc.cjs` - Lighthouse CI configuration (if `--lighthouse`)

## Next Steps

After creating your project:

1. **Start Development**
   ```bash
   cd my-site
   npm run dev
   ```

2. **Build for Production**
   ```bash
   npm run build
   ```

3. **Preview Production Build**
   ```bash
   npm run preview
   ```

4. **Run Lighthouse CI** (if enabled)
   ```bash
   npm run lhci
   ```

## Features

### Included by Default

- ⚡ **Vite-powered** - Lightning fast development and builds
- 🎨 **Component System** - Reusable partials and layouts
- 📱 **SEO Ready** - Automatic sitemaps, robots.txt, meta tags
- 🔍 **Build Audits** - Catch missing titles, descriptions, etc.
- 🚀 **Performance** - Image optimization, minification, lazy loading
- 📊 **Analytics Ready** - Built-in performance monitoring

### Optional Features

- 🖼️ **OG Image Generation** - Automatic social media images
- 💡 **Lighthouse CI** - Automated performance testing

## Configuration

The generated `vite.config.ts` includes comprehensive Monad configuration:

```typescript
export default defineConfig({
  plugins: [
    monad({
      site: {
        url: "https://your-site.com",
        name: "Your Site Name"
      },
      // SEO features
      sitemap: { enabled: true },
      robots: { enabled: true },

      // Performance features
      minify: { enabled: true },
      performance: { enabled: true },
      images: { enabled: true },

      // Optional features (based on CLI options)
      // og: { enabled: true },
      // lighthouse: { enabled: true }
    })
  ]
});
```

## Requirements

- Node.js 18+
- npm, pnpm, yarn, or bun

## Deployment

Generated sites work with any static hosting provider:

- [Netlify](https://netlify.com)
- [Vercel](https://vercel.com)
- [Cloudflare Pages](https://pages.cloudflare.com)
- [GitHub Pages](https://pages.github.com)
- [AWS S3](https://aws.amazon.com/s3)

Simply run `npm run build` and deploy the `dist/` directory.

## Troubleshooting

### "Cannot find module" errors

If you see TypeScript or dependency errors:

```bash
# Install dependencies manually
npm install

# Or use your preferred package manager
pnpm install
yarn install
bun install
```

### Permission errors

If you get permission errors during creation:

```bash
# Use --force to overwrite existing directories
npx @wynterai/create-monad my-site --force
```

### Package manager detection

The CLI auto-detects your package manager by checking:
1. Lock files (pnpm-lock.yaml, yarn.lock, etc.)
2. npm_config_user_agent environment variable
3. Available package managers on system

You can override with `--pm <manager>`.

## Contributing

This package is part of the [Monad](https://github.com/wynterai/monad) monorepo. See the main repository for contribution guidelines.

## License

MIT