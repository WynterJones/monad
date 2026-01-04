# Monad

Monad is an open-source static site generator (SSG) built on **Vite**. You write simple HTML "page templates", compose them with partials, and Monad generates production-ready static pages with:

- **Templates**: HTML pages with JSON frontmatter and slot composition
- **Partials**: `<% header.html, { ... } %>` for reusable components
- **Markdown**: Write pages in Markdown with YAML frontmatter
- **404 Pages**: Automatic 404.html generation with custom templates
- **Redirects**: Generate `_redirects` and `vercel.json` for deployments
- **Link Checking**: Build-time validation of internal links
- **Audit Reports**: SEO and performance warnings (`dist/__monad/report.html`)
- **Sitemap & Robots**: Automatic `sitemap.xml` + `robots.txt` generation
- **Optional Features**: OG image generation and Lighthouse CI (behind flags)

> This repo is a monorepo:
> - `packages/vite-plugin-monad` — the Vite plugin that does the SSG work
> - `packages/monad-website` — the official Monad website built with Monad

## Quick start

```bash
# from the repo root
npm install
npm run dev
```

Then open:
- `/` (Home)
- `/about`
- `/collections-demo`

## Build

```bash
npm -w monad-website run build
npm -w monad-website run preview
```

Outputs:
- `packages/monad-website/dist/` (static site)
- `packages/monad-website/dist/sitemap.xml`
- `packages/monad-website/dist/robots.txt`
- `packages/monad-website/dist/__monad/report.html`

## How templates work

### Pages
Pages live in `packages/monad-website/pages/*.html`.

Each page can include an optional JSON block in an HTML comment:

```html
<!-- monad
{
  "title": "Pricing — Monad",
  "description": "Simple pricing for fast marketing pages.",
  "layout": "layout.html",
  "og": { "title": "Pricing", "subtitle": "Ship faster" }
}
-->
```

Everything after that comment is the page **body**. Monad renders partials inside it, then inserts it into the chosen layout.

### Layouts
Layouts live in `packages/monad-website/partials/_layout.html` and use slots:

- `{{slot:head}}` — meta tags + optional page head additions
- `{{slot:main}}` — the page body
- `{{slot:footer}}` — footer area (optional)

### Partials
Partials are files beginning with `_` inside `partials/`, but you reference them without `_`:

```html
<% header.html, { "active": "pricing" } %>
```

This resolves to `partials/_header.html`.

### Variables
Inside templates you can use `{{ }}` placeholders:

- `{{site.name}}`
- `{{page.title}}`
- `{{data.ctaText}}` (include-level data is available under `data.*`)

## Optional OG images (og-gen)

In `vite.config.ts`, set:

```ts
monad({
  og: { enabled: true, provider: "og-gen", mode: "per-route" }
})
```

**Note:** Monad keeps this optional and lazy-loads `og-gen`. Install it in the site:

```bash
npm -w monad-website i -D og-gen
```

If `og-gen` is missing or its API differs, Monad will warn and skip OG generation.

## Configuration

Here's a complete configuration example showing all available options:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { monad } from 'vite-plugin-monad'

export default defineConfig({
  plugins: [
    monad({
      // Directory structure
      pagesDir: "pages",           // default: "pages"
      partialsDir: "partials",     // default: "partials"
      defaultLayout: "layout.html", // default: "layout.html"

      // URL handling
      cleanUrls: true,             // default: true
      trailingSlash: true,         // default: true

      // Required site metadata
      site: {
        url: "https://example.com",
        name: "My Site",
        locale: "en_US",
        themeColor: "#0b1220",
        twitterHandle: "@myhandle"
      },

      // 404 page generation (NEW IN PHASE 1)
      notFound: {
        enabled: true,             // default: false
        template: "404.html",      // default: "404.html"
        layout: "layout.html"      // override default layout
      },

      // Redirects for deployment platforms (NEW IN PHASE 1)
      redirects: {
        enabled: true,             // default: false
        platform: "both",          // "netlify", "vercel", or "both"
        rules: [
          { from: "/old-path", to: "/new-path", status: 301 },
          { from: "/temp", to: "/permanent", status: 302 }
        ]
      },

      // Markdown support (NEW IN PHASE 1)
      markdown: {
        enabled: true,             // default: false
        gfm: true,                 // GitHub Flavored Markdown
        breaks: false,             // Convert \n to <br>
        pedantic: false,           // Strict markdown.pl behavior
        smartypants: true          // Smart quotes and typography
      },

      // Sitemap generation
      sitemap: {
        enabled: true,             // default: true
        changefreq: "weekly",
        priority: 0.8,
        exclude: ["/admin", "/draft"]
      },

      // Robots.txt generation
      robots: {
        enabled: true,             // default: true
        policy: "allowAll",        // or "disallowAll"
        disallow: ["/admin"]
      },

      // Build-time auditing (includes link checking)
      audit: {
        enabled: true,             // default: true
        mode: "warn",              // "off", "warn", or "fail"
        maxImageBytes: 500000      // warn on large images
      },

      // Optional OG image generation
      og: {
        enabled: false,            // requires og-gen package
        provider: "og-gen",
        mode: "per-route",         // or "single"
        outputDir: "og",
        width: 1200,
        height: 630
      },

      // Optional Lighthouse CI
      lighthouse: {
        enabled: false,            // requires @lhci/cli package
        mode: "autorun"
      }
    })
  ]
})
```

## Phase 1 Features

### 404 Page Generation

Automatically generates a custom 404 page:

```ts
monad({
  notFound: {
    enabled: true,
    template: "404.html",      // Create pages/404.html
    layout: "error-layout.html" // Optional custom layout
  }
})
```

If no `pages/404.html` exists, Monad generates a default 404 page.

### Redirects for Deployment Platforms

Generate redirect files for Netlify and Vercel:

```ts
monad({
  redirects: {
    enabled: true,
    platform: "both",         // Generates both _redirects and vercel.json
    rules: [
      { from: "/blog/*", to: "/posts/:splat", status: 301 },
      { from: "/old", to: "/new" }  // defaults to 301
    ]
  }
})
```

- **Netlify**: Creates `_redirects` file
- **Vercel**: Creates `vercel.json` with redirects
- **Both**: Creates both files

### Markdown Support

Write pages in Markdown with YAML frontmatter:

```ts
monad({
  markdown: {
    enabled: true,
    gfm: true,                 // GitHub Flavored Markdown
    smartypants: true          // Smart typography
  }
})
```

Create `pages/about.md`:

```markdown
---
title: About Us
description: Learn more about our company
layout: content-layout.html
---

# About Our Company

We build **amazing** things with `Markdown` support!

- Feature 1
- Feature 2
- Feature 3
```

### Internal Link Checking

The audit system now checks for broken internal links:

```ts
monad({
  audit: {
    enabled: true,
    mode: "fail"               // Fail build on broken links
  }
})
```

Warnings include:
- Broken links to pages that don't exist
- Missing alt text on images
- Large image files
- Missing SEO elements

## Optional Lighthouse CI

Monad can optionally run Lighthouse CI after a build:

```ts
monad({
  lighthouse: { enabled: true, mode: "autorun" }
})
```

You’ll need Lighthouse CI installed in the site:

```bash
npm -w monad-website i -D @lhci/cli
```

And then run a build. Results go into `dist/__monad/lighthouse/`.

This repo also includes a sample GitHub Actions workflow at `.github/workflows/lighthouse.yml`.

## License

MIT — see `LICENSE`.
