import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import JSON5 from "json5";
import { parse as parseHtml } from "node-html-parser";
import { spawn } from "node:child_process";
import { marked } from "marked";

type AuditMode = "off" | "warn" | "fail";

export type MonadOgProvider = "og-gen";
export type MonadOgMode = "single" | "per-route";

export interface MonadOptions {
  /** Folder containing page templates (HTML). */
  pagesDir?: string;
  /** Folder containing partial templates (HTML). */
  partialsDir?: string;

  /** Default layout partial (referenced without underscore). */
  defaultLayout?: string;

  /** Clean URLs like /about/ -> dist/about/index.html */
  cleanUrls?: boolean;
  /** Add trailing slash to routes */
  trailingSlash?: boolean;

  /** Site-level metadata for canonical/sitemap */
  site: {
    url: string; // https://example.com
    name?: string;
    locale?: string; // en_US
    themeColor?: string;
    twitterHandle?: string; // @handle
  };

  sitemap?: {
    enabled?: boolean;
    changefreq?: string;
    priority?: number;
    exclude?: string[]; // route prefixes
  };

  robots?: {
    enabled?: boolean;
    policy?: "allowAll" | "disallowAll";
    disallow?: string[];
  };

  audit?: {
    enabled?: boolean;
    mode?: AuditMode;
    maxImageBytes?: number; // warnings only when file exists
  };

  /** Accessibility linting configuration */
  accessibility?: {
    enabled?: boolean;
    mode?: AuditMode;
    rules?: {
      headingHierarchy?: boolean; // Check for proper h1-h6 hierarchy
      ariaAttributes?: boolean; // Verify ARIA attributes are valid
      colorContrast?: boolean; // Analyze color contrast ratios
      altText?: boolean; // Check for missing alt text (enhanced beyond basic audit)
      keyboardNavigation?: boolean; // Check for keyboard accessibility patterns
      screenReader?: boolean; // Check for screen reader compatibility
      skipLinks?: boolean; // Check for skip links for main content
      landmarkRoles?: boolean; // Check for proper landmark roles
      tabIndex?: boolean; // Check for proper tab index usage
      focusIndicators?: boolean; // Check for focus indicators on interactive elements
    };
    colorContrast?: {
      minimumRatio?: number; // WCAG AA standard is 4.5:1, AAA is 7:1
      checkLargeText?: boolean; // Large text has lower requirements (3:1 AA, 4.5:1 AAA)
    };
  };

  /** Optional OG image generation */
  og?: {
    enabled?: boolean;
    provider?: MonadOgProvider; // currently only "og-gen"
    mode?: MonadOgMode;
    outputDir?: string; // default "og"
    width?: number; // default 1200
    height?: number; // default 630
  };

  /** Optional Lighthouse CI run after build */
  lighthouse?: {
    enabled?: boolean;
    mode?: "autorun";
  };

  /** 404 page configuration */
  notFound?: {
    enabled?: boolean;
    template?: string; // custom 404 template, defaults to "404.html"
    layout?: string; // override default layout for 404 page
  };

  /** Redirects file generation for Netlify/Vercel */
  redirects?: {
    enabled?: boolean;
    rules?: Array<{
      from: string;
      to: string;
      status?: number; // 301, 302, etc.
    }>;
    platform?: "netlify" | "vercel" | "both"; // which platform format to generate
  };

  /** Markdown support configuration */
  markdown?: {
    enabled?: boolean;
    gfm?: boolean; // GitHub Flavored Markdown
    breaks?: boolean; // Convert '\n' in paragraphs into <br>
    pedantic?: boolean; // Conform to original markdown.pl behavior
  };

  /** HTML minification configuration */
  minify?: {
    enabled?: boolean;
    collapseWhitespace?: boolean;
    removeComments?: boolean;
    removeRedundantAttributes?: boolean;
    removeEmptyAttributes?: boolean;
    minifyCSS?: boolean;
    minifyJS?: boolean;
  };

  /** Performance hints configuration */
  performance?: {
    enabled?: boolean;
    preloadCriticalCss?: boolean;
    addFetchPriority?: boolean;
    lazyLoadImages?: boolean;
    threshold?: number; // pixel threshold for lazy loading images
  };

  /** Font optimization configuration */
  fonts?: {
    enabled?: boolean;
    preconnect?: string[]; // URLs to preconnect to
    preload?: Array<{
      href: string;
      as?: "font";
      type?: string;
      crossorigin?: "anonymous" | "";
    }>;
    displayOptimization?: "swap" | "fallback" | "optional";
  };

  /** Content collections configuration */
  collections?: {
    enabled?: boolean;
    dataFile?: string; // default: "collections.json"
    templateSyntax?: "mustache" | "loop"; // default: "loop"
    pagination?: {
      enabled?: boolean;
      itemsPerPage?: number; // default: 10
      routePattern?: string; // default: "/{collection}/page/{page}"
    };
  };

  /** Image optimization pipeline */
  images?: {
    enabled?: boolean;
    formats?: Array<"webp" | "avif" | "jpg" | "png">; // default: ["webp", "jpg"]
    quality?: {
      webp?: number; // default: 85
      avif?: number; // default: 80
      jpg?: number; // default: 85
    };
    responsive?: {
      enabled?: boolean;
      breakpoints?: number[]; // default: [640, 768, 1024, 1280, 1920]
      sizesAttribute?: string; // default: "(max-width: 768px) 100vw, 50vw"
    };
    lazyLoading?: boolean; // default: true, integrates with performance.lazyLoadImages
    compression?: {
      enabled?: boolean;
      maxWidth?: number; // default: 1920
      maxHeight?: number; // default: 1080
    };
  };
}

type PageMeta = {
  title?: string;
  description?: string;
  layout?: string;
  head?: string;
  og?: { title?: string; subtitle?: string; image?: string };
};

type RenderResult = {
  route: string;
  outFile: string;
  html: string;
  warnings: string[];
  meta: Required<Pick<PageMeta, "title" | "description">> & PageMeta;
};

const DEFAULTS = {
  pagesDir: "pages",
  partialsDir: "partials",
  defaultLayout: "layout.html",
  cleanUrls: true,
  trailingSlash: true,
} as const;

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isPartialFilename(filePath: string): boolean {
  return path.basename(filePath).startsWith("_");
}

/** Routes are derived from page filenames (relative to pagesDir). */
function routeFromRelPath(relFilePath: string, cleanUrls: boolean, trailingSlash: boolean): string {
  const posix = toPosix(relFilePath);
  // Remove .html or .md extension
  const noExt = posix.replace(/\.(html|md)$/i, "");
  if (noExt === "index") return "/";
  const route = "/" + noExt.replace(/index$/i, "").replace(/\/+/g, "/");
  const cleaned = route.endsWith("/") ? route : route + (trailingSlash ? "/" : "");
  if (!cleanUrls) return "/" + noExt + ".html";
  return cleaned;
}

function outFileFromRoute(route: string, distDir: string, cleanUrls: boolean): string {
  const clean = route.startsWith("/") ? route.slice(1) : route;
  if (!cleanUrls) {
    const file = clean === "" ? "index.html" : clean.replace(/\/$/, "") + ".html";
    return path.join(distDir, file);
  }
  if (clean === "") return path.join(distDir, "index.html");
  const folder = clean.replace(/\/$/, "");
  return path.join(distDir, folder, "index.html");
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function tryParsePageMeta(raw: string): { meta: PageMeta; body: string } {
  // Looks for: <!-- monad { ... } -->
  const re = /<!--\s*monad\s*([\s\S]*?)-->/i;
  const m = raw.match(re);
  if (!m) return { meta: {}, body: raw };
  const block = m[1].trim();
  try {
    const meta = JSON5.parse(block) as PageMeta;
    const body = raw.replace(re, "").trim();
    return { meta, body };
  } catch {
    // If meta block is invalid, keep body but emit warning upstream
    const body = raw.replace(re, "").trim();
    return { meta: {}, body };
  }
}

function resolvePartial(partialsDir: string, partialRef: string): string {
  const ref = partialRef.trim().replace(/^["']|["']$/g, "");
  const ext = ref.endsWith(".html") ? "" : ".html";
  const basename = path.basename(ref);
  const dir = path.dirname(ref);
  const underscore = basename.startsWith("_") ? basename : "_" + basename;
  const resolved = path.join(partialsDir, dir === "." ? "" : dir, underscore + ext);
  return resolved;
}

function getByPath(obj: any, dotPath: string): any {
  const parts = dotPath.split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return "";
    cur = cur[p];
  }
  return cur ?? "";
}

function interpolateMustache(template: string, ctx: any): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
    const value = getByPath(ctx, String(expr).trim());
    return String(value);
  });
}

function extractSlotBlocks(html: string): { slots: Record<string, string>; rest: string } {
  // <!-- monad:slot head --> ... <!-- monad:endslot -->
  const slots: Record<string, string> = {};
  const re = /<!--\s*monad:slot\s+(\w+)\s*-->([\s\S]*?)<!--\s*monad:endslot\s*-->/gi;
  let rest = html;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    slots[m[1]] = (m[2] ?? "").trim();
  }
  rest = rest.replace(re, "").trim();
  return { slots, rest };
}

function expandIncludes(params: {
  html: string;
  partialsDir: string;
  ctx: any;
  stack?: string[];
  skipFinalInterpolation?: boolean;
}): string {
  const { partialsDir, ctx, skipFinalInterpolation } = params;
  const stack = params.stack ?? [];
  let html = params.html;

  // Matches: <% header.html, { ... } %> OR <% header.html %>
  const re = /<%\s*([^,%]+?)\s*(?:,\s*([\s\S]*?))?\s*%>/g;

  html = html.replace(re, (_full, rawRef, rawData) => {
    const partialRef = String(rawRef).trim();
    const resolved = resolvePartial(partialsDir, partialRef);
    const abs = path.resolve(resolved);

    if (!fs.existsSync(abs)) {
      return `<!-- monad:missing-partial ${partialRef} -->`;
    }
    if (stack.includes(abs)) {
      return `<!-- monad:cycle ${partialRef} -->`;
    }

    let dataObj: any = {};
    if (rawData && String(rawData).trim()) {
      const text = String(rawData).trim();
      try {
        // Allow either {...} or JSON5 object text
        dataObj = JSON5.parse(text);
      } catch {
        // If parse fails, keep empty.
        dataObj = {};
      }
    }

    const nextCtx = {
      ...ctx,
      data: { ...(ctx?.data ?? {}), ...(dataObj ?? {}) },
    };

    const partialRaw = readText(abs);
    const expanded = expandIncludes({
      html: partialRaw,
      partialsDir,
      ctx: nextCtx,
      stack: [...stack, abs],
    });

    return interpolateMustache(expanded, nextCtx);
  });

  // After includes, do a final pass of interpolation for any remaining {{ }}.
  // Skip this if caller will handle interpolation later (e.g., after collection loops)
  if (skipFinalInterpolation) {
    return html;
  }
  return interpolateMustache(html, ctx);
}

function buildMetaTags(args: {
  siteUrl: string;
  route: string;
  title: string;
  description: string;
  locale?: string;
  twitterHandle?: string;
  ogImageAbs?: string;
  themeColor?: string;
}): string {
  const canonical = normalizeUrl(args.siteUrl) + (args.route === "/" ? "/" : args.route);
  const ogImage = args.ogImageAbs ?? "";
  const locale = args.locale ?? "en_US";
  const twitter = args.twitterHandle ?? "";
  const theme = args.themeColor ?? "";
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(args.title)}</title>`,
    `<meta name="description" content="${escapeAttr(args.description)}">`,
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    theme ? `<meta name="theme-color" content="${escapeAttr(theme)}">` : "",
    // Open Graph
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="${escapeAttr(locale)}">`,
    `<meta property="og:title" content="${escapeAttr(args.title)}">`,
    `<meta property="og:description" content="${escapeAttr(args.description)}">`,
    `<meta property="og:url" content="${escapeAttr(canonical)}">`,
    ogImage ? `<meta property="og:image" content="${escapeAttr(ogImage)}">` : "",
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    twitter ? `<meta name="twitter:site" content="${escapeAttr(twitter)}">` : "",
    `<meta name="twitter:title" content="${escapeAttr(args.title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(args.description)}">`,
    ogImage ? `<meta name="twitter:image" content="${escapeAttr(ogImage)}">` : "",
  ].filter(Boolean).join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

async function minifyHtml(html: string, options: {
  collapseWhitespace?: boolean;
  removeComments?: boolean;
  removeRedundantAttributes?: boolean;
  removeEmptyAttributes?: boolean;
  minifyCSS?: boolean;
  minifyJS?: boolean;
}): Promise<string> {
  try {
    // Dynamic import to handle cases where html-minifier-terser is not installed
    const { minify } = await import("html-minifier-terser");

    return await minify(html, {
      collapseWhitespace: options.collapseWhitespace ?? true,
      removeComments: options.removeComments ?? true,
      removeRedundantAttributes: options.removeRedundantAttributes ?? true,
      removeEmptyAttributes: options.removeEmptyAttributes ?? true,
      minifyCSS: options.minifyCSS ?? true,
      minifyJS: options.minifyJS ?? true,
      keepClosingSlash: true, // Keep self-closing tags consistent
      caseSensitive: true,
      collapseBooleanAttributes: true,
      removeAttributeQuotes: false, // Keep for readability
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      useShortDoctype: true,
    });
  } catch (err) {
    console.warn("HTML minification failed, using original HTML:", err);
    return html;
  }
}

function applyPerformanceHints(html: string, options: {
  preloadCriticalCss?: boolean;
  addFetchPriority?: boolean;
  lazyLoadImages?: boolean;
  threshold?: number;
}): string {
  if (!options.preloadCriticalCss && !options.addFetchPriority && !options.lazyLoadImages) {
    return html;
  }

  const root = parseHtml(html);

  // Add preload for critical CSS files
  if (options.preloadCriticalCss) {
    const links = root.querySelectorAll('link[rel="stylesheet"]');
    const head = root.querySelector('head');

    links.slice(0, 2).forEach(link => { // Preload first 2 CSS files as critical
      const href = link.getAttribute('href');
      if (href && head) {
        const preloadLink = `<link rel="preload" href="${href}" as="style" onload="this.onload=null;this.rel='stylesheet'">`;
        head.insertAdjacentHTML('beforeend', preloadLink);

        // Add fallback noscript
        const noscriptFallback = `<noscript><link rel="stylesheet" href="${href}"></noscript>`;
        head.insertAdjacentHTML('beforeend', noscriptFallback);
      }
    });
  }

  // Add fetchpriority to key resources
  if (options.addFetchPriority) {
    // Hero images get high priority
    const heroImages = root.querySelectorAll('img').slice(0, 1);
    heroImages.forEach(img => {
      img.setAttribute('fetchpriority', 'high');
    });

    // Hero/critical CSS gets high priority
    const criticalCss = root.querySelectorAll('link[rel="stylesheet"]').slice(0, 1);
    criticalCss.forEach(link => {
      link.setAttribute('fetchpriority', 'high');
    });
  }

  // Add lazy loading to images below the fold
  if (options.lazyLoadImages) {
    const images = root.querySelectorAll('img');
    const threshold = options.threshold ?? 600; // Default to 600px from top

    images.forEach((img, index) => {
      // Skip first few images (assume they're above fold)
      if (index >= 2) {
        img.setAttribute('loading', 'lazy');

        // Add decoding attribute for better performance
        img.setAttribute('decoding', 'async');
      }
    });
  }

  return root.toString();
}

function buildFontOptimizationTags(options: {
  preconnect?: string[];
  preload?: Array<{
    href: string;
    as?: "font";
    type?: string;
    crossorigin?: "anonymous" | "";
  }>;
  displayOptimization?: "swap" | "fallback" | "optional";
}): string {
  const tags: string[] = [];

  // Add preconnect links for external font sources
  if (options.preconnect) {
    for (const url of options.preconnect) {
      tags.push(`<link rel="preconnect" href="${escapeAttr(url)}">`)
      // Add dns-prefetch as fallback
      tags.push(`<link rel="dns-prefetch" href="${escapeAttr(url)}">`);
    }
  }

  // Add preload links for critical font files
  if (options.preload) {
    for (const font of options.preload) {
      const attrs = [
        `rel="preload"`,
        `href="${escapeAttr(font.href)}"`,
        `as="${font.as ?? 'font'}"`,
      ];

      if (font.type) {
        attrs.push(`type="${escapeAttr(font.type)}"`);
      }

      if (font.crossorigin !== undefined) {
        attrs.push(`crossorigin="${escapeAttr(font.crossorigin)}"`);
      } else {
        attrs.push('crossorigin="anonymous"'); // Default for fonts
      }

      tags.push(`<link ${attrs.join(' ')}>`);
    }
  }

  // Add font-display CSS if display optimization is enabled
  if (options.displayOptimization) {
    const fontDisplayCSS = `
<style>
@font-face {
  font-display: ${options.displayOptimization};
}
</style>`.trim();
    tags.push(fontDisplayCSS);
  }

  return tags.join('\n');
}

function loadViteManifest(distDir: string): any | null {
  // Vite can emit the manifest at `.vite/manifest.json` when build.manifest = true,
  // or at a custom path when build.manifest is a string.
  const candidates = [
    path.join(distDir, "manifest.json"),
    path.join(distDir, ".vite", "manifest.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(readText(p));
    } catch {
      // keep trying
    }
  }
  return null;
}


function buildAssetTags(args: { isDev: boolean; manifest: any | null; entry: string }): string {
  if (args.isDev) {
    return `<script type="module" src="/${args.entry}"></script>`;
  }
  if (!args.manifest) return "";
  const entryKey = args.entry;
  const m = args.manifest[entryKey];
  if (!m) return "";
  const tags: string[] = [];
  if (Array.isArray(m.css)) {
    for (const css of m.css) {
      tags.push(`<link rel="stylesheet" href="/${css}">`);
    }
  }
  if (m.file) {
    tags.push(`<script type="module" src="/${m.file}"></script>`);
  }
  return tags.join("\n");
}

async function tryGenerateOgImage(params: {
  provider: MonadOgProvider;
  title: string;
  subtitle?: string;
  outPath: string;
  width: number;
  height: number;
}): Promise<{ ok: boolean; message?: string }> {
  // Provider: "og-gen" (optional dependency)
  if (params.provider !== "og-gen") return { ok: false, message: "Unknown provider" };

  try {
    // We don't know exact API shape; attempt common patterns.
    const mod: any = await import("og-gen");
    const fn = mod?.default ?? mod?.generate ?? mod?.ogGen ?? null;
    if (typeof fn !== "function") {
      return { ok: false, message: "og-gen loaded but no generator function found (expected default export or generate())" };
    }

    // Try a few call signatures:
    // 1) fn({ title, subtitle, width, height, output })
    // 2) fn(title, options)
    const outDir = path.dirname(params.outPath);
    fs.mkdirSync(outDir, { recursive: true });

    let result: any;
    try {
      result = await fn({
        title: params.title,
        subtitle: params.subtitle,
        width: params.width,
        height: params.height,
        output: params.outPath,
      });
    } catch {
      result = await fn(params.title, {
        subtitle: params.subtitle,
        width: params.width,
        height: params.height,
        output: params.outPath,
      });
    }

    // If og-gen writes file itself, we're done; otherwise if it returns a buffer, write it.
    if (!fs.existsSync(params.outPath) && result) {
      if (result instanceof Uint8Array) fs.writeFileSync(params.outPath, result);
      if (result?.buffer) fs.writeFileSync(params.outPath, Buffer.from(result.buffer));
      if (result?.png) fs.writeFileSync(params.outPath, Buffer.from(result.png));
    }

    if (!fs.existsSync(params.outPath)) {
      return { ok: false, message: "og-gen ran but no output file was created (check og-gen API)" };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err?.message ?? err) };
  }
}

// Utility function to convert hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Calculate relative luminance for color contrast
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Calculate contrast ratio between two colors
function getContrastRatio(color1: string, color2: string): number | null {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) return null;

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);

  return (brightest + 0.05) / (darkest + 0.05);
}

// Known ARIA attributes for validation
const VALID_ARIA_ATTRIBUTES = new Set([
  'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-expanded',
  'aria-selected', 'aria-checked', 'aria-pressed', 'aria-disabled', 'aria-required',
  'aria-invalid', 'aria-live', 'aria-atomic', 'aria-busy', 'aria-relevant',
  'aria-dropeffect', 'aria-grabbed', 'aria-haspopup', 'aria-level', 'aria-multiline',
  'aria-multiselectable', 'aria-orientation', 'aria-readonly', 'aria-sort',
  'aria-valuemax', 'aria-valuemin', 'aria-valuenow', 'aria-valuetext',
  'aria-controls', 'aria-flowto', 'aria-owns', 'aria-posinset', 'aria-setsize',
  'aria-activedescendant', 'aria-current', 'aria-details', 'aria-errormessage',
  'aria-keyshortcuts', 'aria-roledescription', 'aria-autocomplete', 'aria-colcount',
  'aria-colindex', 'aria-colspan', 'aria-rowcount', 'aria-rowindex', 'aria-rowspan'
]);

const VALID_ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell',
  'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo',
  'definition', 'dialog', 'directory', 'document', 'feed', 'figure', 'form',
  'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox',
  'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
  'rowgroup', 'rowheader', 'scrollbar', 'search', 'separator', 'slider',
  'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel',
  'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid',
  'treeitem'
]);

function auditAccessibility(html: string, route: string, options: {
  enabled: boolean;
  mode: AuditMode;
  rules: {
    headingHierarchy: boolean;
    ariaAttributes: boolean;
    colorContrast: boolean;
    altText: boolean;
    keyboardNavigation: boolean;
    screenReader: boolean;
    skipLinks: boolean;
    landmarkRoles: boolean;
    tabIndex: boolean;
    focusIndicators: boolean;
  };
  colorContrast: {
    minimumRatio: number;
    checkLargeText: boolean;
  };
}): string[] {
  if (!options.enabled) return [];

  const warnings: string[] = [];
  const root = parseHtml(html);

  // 1. Heading Hierarchy Check
  if (options.rules.headingHierarchy) {
    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let previousLevel = 0;
    let hasH1 = false;
    let h1Count = 0;

    headings.forEach((heading) => {
      const tagName = heading.tagName.toLowerCase();
      const currentLevel = parseInt(tagName.charAt(1));

      if (currentLevel === 1) {
        hasH1 = true;
        h1Count++;
        if (h1Count > 1) {
          warnings.push(`Multiple h1 elements found (${h1Count}). Use only one h1 per page`);
        }
      }

      if (previousLevel > 0 && currentLevel > previousLevel + 1) {
        warnings.push(`Heading hierarchy skipped level: ${tagName.toUpperCase()} after h${previousLevel}`);
      }

      previousLevel = currentLevel;
    });

    if (!hasH1) {
      warnings.push('Missing h1 element - every page should have exactly one h1');
    }
  }

  // 2. ARIA Attributes Validation
  if (options.rules.ariaAttributes) {
    const elementsWithAria = root.querySelectorAll('[aria-label], [aria-labelledby], [aria-describedby], [role], [aria-hidden], [aria-expanded], [aria-selected], [aria-checked], [aria-pressed], [aria-disabled], [aria-required], [aria-invalid]');

    elementsWithAria.forEach((element) => {
      // Check for valid ARIA attributes
      const attrs = element.attributes || {};
      Object.keys(attrs).forEach((attrName) => {
        if (attrName.startsWith('aria-') && !VALID_ARIA_ATTRIBUTES.has(attrName)) {
          warnings.push(`Invalid ARIA attribute: ${attrName} on ${element.tagName.toLowerCase()}`);
        }
      });

      // Check for valid role attribute
      const role = element.getAttribute('role');
      if (role && !VALID_ARIA_ROLES.has(role)) {
        warnings.push(`Invalid ARIA role: ${role} on ${element.tagName.toLowerCase()}`);
      }

      // Check for required ARIA attributes based on role
      if (role === 'button' && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent?.trim()) {
        warnings.push('Button with role="button" must have accessible text (aria-label, aria-labelledby, or text content)');
      }

      if (role === 'img' && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
        warnings.push('Element with role="img" must have aria-label or aria-labelledby');
      }
    });
  }

  // 3. Enhanced Alt Text Check
  if (options.rules.altText) {
    const images = root.querySelectorAll('img');
    images.forEach((img) => {
      const alt = img.getAttribute('alt');
      const role = img.getAttribute('role');

      if (alt === null) {
        warnings.push('Image missing alt attribute');
      } else if (alt && alt.trim() === '' && role !== 'presentation' && !img.getAttribute('aria-hidden')) {
        warnings.push('Image has empty alt attribute without role="presentation" or aria-hidden');
      } else if (alt && (alt.includes('image of') || alt.includes('picture of') || alt.includes('graphic of'))) {
        warnings.push('Alt text should not include redundant phrases like "image of" or "picture of"');
      }
    });

    // Check for images used as buttons/links without proper accessibility
    const imageButtons = root.querySelectorAll('button img, a img');
    imageButtons.forEach((img) => {
      const parent = img.parentNode;
      const parentText = parent?.textContent?.trim();
      const alt = img.getAttribute('alt');

      if (!alt && !parentText) {
        warnings.push('Image inside button/link must have alt text when no other text is present');
      }
    });
  }

  // 4. Keyboard Navigation Check
  if (options.rules.keyboardNavigation) {
    // Check for interactive elements without proper focus handling
    const interactiveElements = root.querySelectorAll('button, a, input, select, textarea, [tabindex]');

    interactiveElements.forEach((element) => {
      const tagName = element.tagName.toLowerCase();
      const tabIndex = element.getAttribute('tabindex');

      // Warn about positive tabindex values
      if (tabIndex && parseInt(tabIndex) > 0) {
        warnings.push(`Avoid positive tabindex values: ${tagName} has tabindex="${tabIndex}"`);
      }

      // Check for links without href
      if (tagName === 'a' && !element.getAttribute('href')) {
        warnings.push('Link element without href attribute - use button for actions');
      }

      // Check for buttons without type
      if (tagName === 'button' && !element.getAttribute('type')) {
        warnings.push('Button element should have explicit type attribute');
      }
    });

    // Check for click handlers on non-interactive elements
    const nonInteractiveWithHandlers = root.querySelectorAll('div[onclick], span[onclick], p[onclick]');
    nonInteractiveWithHandlers.forEach((element) => {
      warnings.push(`Interactive behavior on non-interactive element: ${element.tagName.toLowerCase()} with onclick. Consider using button or adding role and keyboard support`);
    });
  }

  // 5. Screen Reader Compatibility
  if (options.rules.screenReader) {
    // Check for form inputs without labels
    const inputs = root.querySelectorAll('input, select, textarea');
    inputs.forEach((input) => {
      const id = input.getAttribute('id');
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledby = input.getAttribute('aria-labelledby');

      if (!ariaLabel && !ariaLabelledby) {
        if (!id || !root.querySelector(`label[for="${id}"]`)) {
          warnings.push(`Form input without accessible label: ${input.tagName.toLowerCase()}`);
        }
      }
    });

    // Check for tables without captions or summary
    const tables = root.querySelectorAll('table');
    tables.forEach((table) => {
      const caption = table.querySelector('caption');
      const summary = table.getAttribute('summary');
      const ariaLabel = table.getAttribute('aria-label');

      if (!caption && !summary && !ariaLabel) {
        warnings.push('Data table should have caption, summary, or aria-label for screen readers');
      }
    });

    // Check for list markup
    const listItems = root.querySelectorAll('li');
    listItems.forEach((li) => {
      const parent = li.parentNode;
      if (parent && !['ul', 'ol'].includes(parent.tagName.toLowerCase())) {
        warnings.push('List item (li) must be inside ul or ol element');
      }
    });
  }

  // 6. Skip Links Check
  if (options.rules.skipLinks) {
    const skipLinks = root.querySelectorAll('a[href^="#"]');
    const hasMainContent = root.querySelector('main, [role="main"], #main, #content');

    if (hasMainContent && skipLinks.length === 0) {
      warnings.push('Consider adding skip links to main content for keyboard navigation');
    }

    skipLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href !== '#') {
        const target = root.querySelector(href);
        if (!target) {
          warnings.push(`Skip link points to non-existent target: ${href}`);
        }
      }
    });
  }

  // 7. Landmark Roles Check
  if (options.rules.landmarkRoles) {
    const hasMain = root.querySelector('main, [role="main"]');
    const hasNav = root.querySelector('nav, [role="navigation"]');
    const hasHeader = root.querySelector('header, [role="banner"]');
    const hasFooter = root.querySelector('footer, [role="contentinfo"]');

    if (!hasMain) {
      warnings.push('Page should have a main landmark (main element or role="main")');
    }

    // Check for multiple main landmarks
    const mains = root.querySelectorAll('main, [role="main"]');
    if (mains.length > 1) {
      warnings.push(`Multiple main landmarks found (${mains.length}). Use only one main per page`);
    }
  }

  // 8. Tab Index Check
  if (options.rules.tabIndex) {
    const negativeTabIndex = root.querySelectorAll('[tabindex="-1"]');
    const positiveTabIndex = root.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])');

    positiveTabIndex.forEach((element) => {
      const tabIndex = element.getAttribute('tabindex');
      warnings.push(`Avoid positive tabindex values: ${element.tagName.toLowerCase()} has tabindex="${tabIndex}"`);
    });

    // Check for elements that should be focusable
    const shouldBeFocusable = root.querySelectorAll('button:disabled, input:disabled');
    shouldBeFocusable.forEach((element) => {
      if (!element.getAttribute('tabindex')) {
        // This is actually correct behavior - disabled elements shouldn't be focusable
        // Just documenting the check here
      }
    });
  }

  // 9. Focus Indicators Check
  if (options.rules.focusIndicators) {
    // This would typically require CSS analysis, but we can check for common patterns
    const interactiveElements = root.querySelectorAll('button, a, input, select, textarea, [tabindex="0"]');

    // Check if there's any CSS that might remove focus indicators
    const styles = root.querySelectorAll('style');
    let hasFocusStyles = false;

    styles.forEach((style) => {
      const cssText = style.innerHTML;
      if (cssText.includes(':focus') || cssText.includes('outline')) {
        hasFocusStyles = true;
      }
      if (cssText.includes('outline: none') || cssText.includes('outline:none')) {
        warnings.push('CSS removes focus outline without providing alternative focus indicator');
      }
    });

    // Basic heuristic: if there are interactive elements but no focus styles, warn
    if (interactiveElements.length > 0 && !hasFocusStyles) {
      warnings.push('Interactive elements should have visible focus indicators for keyboard users');
    }
  }

  // 10. Color Contrast Analysis (basic implementation)
  if (options.rules.colorContrast) {
    // This is a simplified implementation - full contrast analysis would require
    // parsing CSS and computing final styles for all text elements
    const inlineStyles = root.querySelectorAll('[style*="color"]');

    inlineStyles.forEach((element) => {
      const style = element.getAttribute('style') || '';
      const colorMatch = style.match(/color:\s*([#\w]+)/);
      const bgColorMatch = style.match(/background(?:-color)?:\s*([#\w]+)/);

      if (colorMatch && bgColorMatch) {
        const ratio = getContrastRatio(colorMatch[1], bgColorMatch[1]);
        if (ratio !== null && ratio < options.colorContrast.minimumRatio) {
          warnings.push(`Low color contrast ratio: ${ratio.toFixed(2)}:1 (minimum: ${options.colorContrast.minimumRatio}:1) on ${element.tagName.toLowerCase()}`);
        }
      }
    });
  }

  return warnings;
}

function auditHtml(html: string, route: string, opts?: { distDirAbs?: string; maxImageBytes?: number; allRoutes?: string[] }): string[] {
  const warnings: string[] = [];
  if (!/<title>\s*[^<]+\s*<\/title>/i.test(html)) warnings.push("Missing <title>");
  if (!/<meta\s+name=["']description["']\s+content=["'][^"']+["']\s*\/?>/i.test(html)) warnings.push("Missing meta description");
  const h1 = html.match(/<h1\b/gi)?.length ?? 0;
  if (h1 === 0) warnings.push("Missing <h1>");
  if (h1 > 1) warnings.push(`Multiple <h1> (${h1})`);

  const root = parseHtml(html);
  const imgs = root.querySelectorAll("img");
  for (const img of imgs) {
    const alt = img.getAttribute("alt");
    if (alt == null || alt.trim() === "") warnings.push("Image missing alt attribute");

    const src = img.getAttribute("src") ?? "";
    const maxBytes = opts?.maxImageBytes ?? 500_000;
    const distDirAbs = opts?.distDirAbs;
    if (distDirAbs && src.startsWith("/")) {
      const diskPath = path.join(distDirAbs, src.replace(/^\//, ""));
      try {
        if (fs.existsSync(diskPath)) {
          const size = fs.statSync(diskPath).size;
          if (size > maxBytes) {
            warnings.push(`Large image (${Math.round(size / 1024)} KB): ${src} (budget ${Math.round(maxBytes / 1024)} KB)`);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Internal link checking
  if (opts?.allRoutes) {
    const links = root.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";

      // Check only internal links (starting with / but not //)
      if (href.startsWith("/") && !href.startsWith("//")) {
        // Remove query params and fragments
        const cleanHref = href.split("?")[0].split("#")[0];

        // Check if the route exists
        const routeExists = opts.allRoutes.some(route => {
          // Direct match
          if (route === cleanHref) return true;

          // Handle trailing slash differences
          const normalizedRoute = route.endsWith("/") ? route : route + "/";
          const normalizedHref = cleanHref.endsWith("/") ? cleanHref : cleanHref + "/";
          return normalizedRoute === normalizedHref;
        });

        if (!routeExists) {
          warnings.push(`Broken internal link: ${href}`);
        }
      }
    }
  }

  if (!/rel=["']icon["']/i.test(html) && !/rel=["']shortcut icon["']/i.test(html)) {
    warnings.push("No favicon <link rel=\"icon\"> found (consider adding)");
  }
  if (!/rel=["']canonical["']/i.test(html)) warnings.push("Missing canonical link tag");
  return warnings;
}


function htmlReport(results: RenderResult[]): string {
  const rows = results.map(r => {
    const warn = r.warnings.length ? `<ul>${r.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : `<span class="ok">OK</span>`;
    return `<tr>
      <td><code>${escapeHtml(r.route)}</code></td>
      <td>${escapeHtml(r.meta.title ?? "")}</td>
      <td>${warn}</td>
    </tr>`;
  }).join("\n");

  const totalWarnings = results.reduce((acc, r) => acc + r.warnings.length, 0);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Monad Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 24px; }
    h1 { margin: 0 0 8px; }
    .meta { color: #555; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #ddd; padding: 10px; vertical-align: top; }
    th { text-align: left; background: #f7f7f7; }
    .ok { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e9fbe9; color: #165b16; font-weight: 600; font-size: 12px; }
    ul { margin: 0; padding-left: 18px; }
    code { background: #f3f3f3; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Monad build report</h1>
  <div class="meta">${results.length} pages • ${totalWarnings} warnings</div>
  <table>
    <thead>
      <tr><th>Route</th><th>Title</th><th>Warnings</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function writeFileEnsured(filePath: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function generateSitemap(siteUrl: string, routes: { route: string; lastmod?: string }[], opts?: { changefreq?: string; priority?: number }): string {
  const urlset = routes.map(r => {
    const loc = normalizeUrl(siteUrl) + (r.route === "/" ? "/" : r.route);
    const lastmod = r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : "";
    const cf = opts?.changefreq ? `<changefreq>${opts.changefreq}</changefreq>` : "";
    const pr = typeof opts?.priority === "number" ? `<priority>${opts.priority.toFixed(1)}</priority>` : "";
    return `<url><loc>${escapeHtml(loc)}</loc>${lastmod}${cf}${pr}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlset}</urlset>`;
}

function generateRobots(siteUrl: string, policy: "allowAll" | "disallowAll", disallow: string[] | undefined): string {
  const lines: string[] = [];
  lines.push("User-agent: *");
  if (policy === "disallowAll") {
    lines.push("Disallow: /");
  } else {
    if (disallow && disallow.length) {
      for (const d of disallow) lines.push(`Disallow: ${d}`);
    } else {
      lines.push("Allow: /");
    }
  }
  lines.push(`Sitemap: ${normalizeUrl(siteUrl)}/sitemap.xml`);
  return lines.join("\n") + "\n";
}

function generateNetlifyRedirects(rules: Array<{ from: string; to: string; status?: number }>): string {
  const lines = rules.map(rule => {
    const status = rule.status ?? 301;
    return `${rule.from}  ${rule.to}  ${status}`;
  });
  return lines.join("\n") + "\n";
}

function generateVercelRedirects(rules: Array<{ from: string; to: string; status?: number }>): string {
  const redirects = rules.map(rule => ({
    source: rule.from,
    destination: rule.to,
    permanent: (rule.status ?? 301) === 301,
    statusCode: rule.status && rule.status !== 301 ? rule.status : undefined,
  }));

  return JSON.stringify({ redirects }, null, 2);
}

function parseMarkdownFrontmatter(content: string): { meta: PageMeta; body: string } {
  // Check for frontmatter (YAML between --- lines)
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // No frontmatter, entire content is markdown
    return { meta: {}, body: content.trim() };
  }

  try {
    // Parse YAML frontmatter as JSON5 (more lenient)
    const yamlContent = match[1];
    // Convert YAML-like syntax to JSON5-compatible format
    const jsonContent = yamlContent
      .replace(/^(\s*)([^:]+):\s*/gm, '$1"$2": ')  // Quote keys
      .replace(/:\s*([^"{\[\n]+)$/gm, ': "$1"');   // Quote unquoted string values

    let meta: PageMeta = {};
    try {
      meta = JSON5.parse(`{${jsonContent}}`);
    } catch {
      // If JSON5 parsing fails, try simpler key-value parsing
      const lines = yamlContent.split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');
          if (key.trim() === 'title') meta.title = value;
          else if (key.trim() === 'description') meta.description = value;
          else if (key.trim() === 'layout') meta.layout = value;
        }
      }
    }

    return { meta, body: match[2].trim() };
  } catch {
    // If frontmatter parsing fails, treat as no frontmatter
    return { meta: {}, body: content.trim() };
  }
}

function renderMarkdown(markdown: string, options?: {
  gfm?: boolean;
  breaks?: boolean;
  pedantic?: boolean;
}): string {
  // Configure marked with options
  marked.setOptions({
    gfm: options?.gfm ?? true,
    breaks: options?.breaks ?? false,
    pedantic: options?.pedantic ?? false,
  });

  try {
    const result = marked(markdown);
    return typeof result === 'string' ? result : String(result);
  } catch (err) {
    console.warn('Markdown parsing error:', err);
    return `<pre><code>${escapeHtml(markdown)}</code></pre>`;
  }
}

function listPages(pagesDirAbs: string, markdownEnabled = false): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && !isPartialFilename(p)) {
        const name = ent.name.toLowerCase();
        if (name.endsWith(".html")) {
          out.push(p);
        } else if (markdownEnabled && name.endsWith(".md")) {
          out.push(p);
        }
      }
    }
  };
  walk(pagesDirAbs);
  return out.sort();
}

function loadCollectionsData(root: string, dataFile: string): Record<string, any[]> {
  const collectionsPath = path.resolve(root, dataFile);
  if (!fs.existsSync(collectionsPath)) {
    return {};
  }

  try {
    const content = readText(collectionsPath);
    return JSON5.parse(content);
  } catch (err) {
    console.warn(`Failed to parse collections data from ${dataFile}:`, err);
    return {};
  }
}

function expandCollectionLoops(html: string, collections: Record<string, any[]>): string {
  // Pattern: <!-- monad:loop item in collection.items -->...<!-- monad:endloop -->
  const loopPattern = /<!--\s*monad:loop\s+(\w+)\s+in\s+([\w.]+)\s*-->([\s\S]*?)<!--\s*monad:endloop\s*-->/g;

  let result = html;
  let match;

  while ((match = loopPattern.exec(html)) !== null) {
    const [fullMatch, itemVar, collectionPath, template] = match;
    const collection = getByPath(collections, collectionPath);

    if (!Array.isArray(collection)) {
      console.warn(`Collection ${collectionPath} not found or not an array`);
      result = result.replace(fullMatch, `<!-- Collection ${collectionPath} not found -->`);
      continue;
    }

    let rendered = '';
    collection.forEach((item, index) => {
      let itemHtml = template;
      // Replace {{item.field}} with actual values
      itemHtml = itemHtml.replace(new RegExp(`{{\\s*${itemVar}\\.(\\w+)\\s*}}`, 'g'), (_, field) => {
        return item[field] ?? '';
      });
      // Replace {{item}} with JSON representation if used directly
      itemHtml = itemHtml.replace(new RegExp(`{{\\s*${itemVar}\\s*}}`, 'g'), JSON.stringify(item));
      // Replace {{@index}} with loop index
      itemHtml = itemHtml.replace(/{{@index}}/g, index.toString());
      // Replace {{@index1}} with 1-based index
      itemHtml = itemHtml.replace(/{{@index1}}/g, (index + 1).toString());

      rendered += itemHtml;
    });

    result = result.replace(fullMatch, rendered);
  }

  return result;
}

function generateResponsiveImages(html: string, options: {
  enabled: boolean;
  formats: Array<"webp" | "avif" | "jpg" | "png">;
  breakpoints: number[];
  sizesAttribute: string;
  quality: { webp?: number; avif?: number; jpg?: number };
}): { html: string; imagesToProcess: Array<{ src: string; formats: string[] }> } {
  if (!options.enabled) {
    return { html, imagesToProcess: [] };
  }

  const root = parseHtml(html);
  const images = root.querySelectorAll('img[src]');
  const imagesToProcess: Array<{ src: string; formats: string[] }> = [];

  images.forEach(img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('http') || src.startsWith('data:')) {
      return; // Skip external and data URLs
    }

    // Skip images with data-no-optimize attribute
    if (img.hasAttribute('data-no-optimize')) {
      return;
    }

    const alt = img.getAttribute('alt') || '';
    const className = img.getAttribute('class') || '';

    // Generate srcset for different formats
    const baseFormats = options.formats.filter(f => f !== 'avif'); // AVIF goes in picture element
    const useAvif = options.formats.includes('avif');

    if (useAvif || baseFormats.length > 1) {
      // Use picture element for multiple formats
      let pictureHtml = '<picture>';

      // Add AVIF source if enabled
      if (useAvif) {
        const avifSrcset = options.breakpoints
          .map(bp => `${src.replace(/\.[^.]+$/, `-${bp}w.avif`)} ${bp}w`)
          .join(', ');
        pictureHtml += `<source type="image/avif" srcset="${avifSrcset}" sizes="${options.sizesAttribute}">`;
        imagesToProcess.push({ src, formats: ['avif'] });
      }

      // Add WebP source if enabled
      if (baseFormats.includes('webp')) {
        const webpSrcset = options.breakpoints
          .map(bp => `${src.replace(/\.[^.]+$/, `-${bp}w.webp`)} ${bp}w`)
          .join(', ');
        pictureHtml += `<source type="image/webp" srcset="${webpSrcset}" sizes="${options.sizesAttribute}">`;
        imagesToProcess.push({ src, formats: ['webp'] });
      }

      // Add fallback img with responsive sizes
      const fallbackSrcset = options.breakpoints
        .map(bp => `${src.replace(/\.[^.]+$/, `-${bp}w.jpg`)} ${bp}w`)
        .join(', ');
      pictureHtml += `<img src="${src}" srcset="${fallbackSrcset}" sizes="${options.sizesAttribute}" alt="${alt}" class="${className}">`;
      pictureHtml += '</picture>';

      img.replaceWith(pictureHtml);
      imagesToProcess.push({ src, formats: ['jpg'] });
    } else {
      // Single format, just add srcset
      const format = baseFormats[0] || 'jpg';
      const srcset = options.breakpoints
        .map(bp => `${src.replace(/\.[^.]+$/, `-${bp}w.${format}`)} ${bp}w`)
        .join(', ');

      img.setAttribute('srcset', srcset);
      img.setAttribute('sizes', options.sizesAttribute);
      imagesToProcess.push({ src, formats: [format] });
    }
  });

  return { html: root.toString(), imagesToProcess };
}

async function processImages(imagesToProcess: Array<{ src: string; formats: string[] }>, options: {
  quality: { webp?: number; avif?: number; jpg?: number };
  compression: { enabled: boolean; maxWidth?: number; maxHeight?: number };
  breakpoints: number[];
}, root: string, distDir: string): Promise<void> {
  if (imagesToProcess.length === 0) {
    return;
  }

  // Check for sharp dependency
  let sharp: any;
  try {
    sharp = await import('sharp');
  } catch (err) {
    console.warn('Sharp not installed, skipping image optimization. Install with: npm install sharp');
    return;
  }

  for (const { src, formats } of imagesToProcess) {
    // Try public/ first, then src/
    let srcPath = path.resolve(root, 'public', src.replace(/^\//, ''));
    if (!fs.existsSync(srcPath)) {
      srcPath = path.resolve(root, 'src', src.replace(/^\//, ''));
    }
    if (!fs.existsSync(srcPath)) {
      console.warn(`Image not found: ${srcPath}`);
      continue;
    }

    try {
      const image = sharp.default(srcPath);
      const metadata = await image.metadata();

      for (const format of formats) {
        for (const breakpoint of options.breakpoints) {
          // Skip if breakpoint is larger than original image
          if (metadata.width && breakpoint > metadata.width) {
            continue;
          }

          let pipeline = image.clone().resize(breakpoint, null, {
            withoutEnlargement: true,
            fit: 'inside'
          });

          const quality = options.quality[format as keyof typeof options.quality] ?? 85;

          switch (format) {
            case 'webp':
              pipeline = pipeline.webp({ quality });
              break;
            case 'avif':
              pipeline = pipeline.avif({ quality });
              break;
            case 'jpg':
              pipeline = pipeline.jpeg({ quality });
              break;
            case 'png':
              pipeline = pipeline.png({ quality: Math.floor(quality / 100 * 9) }); // PNG quality is 0-9
              break;
          }

          const outputPath = path.resolve(distDir, src.replace(/^\//, '').replace(/\.[^.]+$/, `-${breakpoint}w.${format}`));
          writeFileEnsured(outputPath, await pipeline.toBuffer());
        }
      }
    } catch (err) {
      console.warn(`Failed to process image ${srcPath}:`, err);
    }
  }
}

async function runLighthouseAutorun(projectRoot: string, distDir: string): Promise<void> {
  // Runs: npx lhci autorun --collect.staticDistDir=dist
  await new Promise<void>((resolve) => {
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", [
      "lhci",
      "autorun",
      `--collect.staticDistDir=${distDir}`,
      `--upload.target=filesystem`,
      `--upload.outputDir=${path.join(distDir, "__monad", "lighthouse")}`,
    ], { stdio: "inherit", cwd: projectRoot });

    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

export default function monad(userOptions: MonadOptions): Plugin {
  const options: Required<MonadOptions> = {
    pagesDir: userOptions.pagesDir ?? DEFAULTS.pagesDir,
    partialsDir: userOptions.partialsDir ?? DEFAULTS.partialsDir,
    defaultLayout: userOptions.defaultLayout ?? DEFAULTS.defaultLayout,
    cleanUrls: userOptions.cleanUrls ?? DEFAULTS.cleanUrls,
    trailingSlash: userOptions.trailingSlash ?? DEFAULTS.trailingSlash,
    site: userOptions.site,
    sitemap: { enabled: userOptions.sitemap?.enabled ?? true, ...userOptions.sitemap },
    robots: { enabled: userOptions.robots?.enabled ?? true, ...userOptions.robots },
    audit: { enabled: userOptions.audit?.enabled ?? true, mode: userOptions.audit?.mode ?? "warn", maxImageBytes: userOptions.audit?.maxImageBytes ?? 500_000 },
    accessibility: {
      enabled: userOptions.accessibility?.enabled ?? true,
      mode: userOptions.accessibility?.mode ?? "warn",
      rules: {
        headingHierarchy: userOptions.accessibility?.rules?.headingHierarchy ?? true,
        ariaAttributes: userOptions.accessibility?.rules?.ariaAttributes ?? true,
        colorContrast: userOptions.accessibility?.rules?.colorContrast ?? true,
        altText: userOptions.accessibility?.rules?.altText ?? true,
        keyboardNavigation: userOptions.accessibility?.rules?.keyboardNavigation ?? true,
        screenReader: userOptions.accessibility?.rules?.screenReader ?? true,
        skipLinks: userOptions.accessibility?.rules?.skipLinks ?? true,
        landmarkRoles: userOptions.accessibility?.rules?.landmarkRoles ?? true,
        tabIndex: userOptions.accessibility?.rules?.tabIndex ?? true,
        focusIndicators: userOptions.accessibility?.rules?.focusIndicators ?? true,
      },
      colorContrast: {
        minimumRatio: userOptions.accessibility?.colorContrast?.minimumRatio ?? 4.5,
        checkLargeText: userOptions.accessibility?.colorContrast?.checkLargeText ?? true,
      }
    },
    og: { enabled: userOptions.og?.enabled ?? false, provider: userOptions.og?.provider ?? "og-gen", mode: userOptions.og?.mode ?? "per-route", outputDir: userOptions.og?.outputDir ?? "og", width: userOptions.og?.width ?? 1200, height: userOptions.og?.height ?? 630 },
    lighthouse: { enabled: userOptions.lighthouse?.enabled ?? false, mode: userOptions.lighthouse?.mode ?? "autorun" },
    notFound: { enabled: userOptions.notFound?.enabled ?? true, ...userOptions.notFound },
    redirects: { enabled: userOptions.redirects?.enabled ?? false, ...userOptions.redirects },
    markdown: { enabled: userOptions.markdown?.enabled ?? false, ...userOptions.markdown },
    minify: { enabled: userOptions.minify?.enabled ?? true, collapseWhitespace: userOptions.minify?.collapseWhitespace ?? true, removeComments: userOptions.minify?.removeComments ?? true, removeRedundantAttributes: userOptions.minify?.removeRedundantAttributes ?? true, removeEmptyAttributes: userOptions.minify?.removeEmptyAttributes ?? true, minifyCSS: userOptions.minify?.minifyCSS ?? true, minifyJS: userOptions.minify?.minifyJS ?? true },
    performance: { enabled: userOptions.performance?.enabled ?? true, preloadCriticalCss: userOptions.performance?.preloadCriticalCss ?? true, addFetchPriority: userOptions.performance?.addFetchPriority ?? true, lazyLoadImages: userOptions.performance?.lazyLoadImages ?? true, threshold: userOptions.performance?.threshold ?? 600 },
    fonts: { enabled: userOptions.fonts?.enabled ?? false, preconnect: userOptions.fonts?.preconnect ?? [], preload: userOptions.fonts?.preload ?? [], displayOptimization: userOptions.fonts?.displayOptimization ?? "swap" },
    collections: { enabled: userOptions.collections?.enabled ?? false, dataFile: userOptions.collections?.dataFile ?? "collections.json", templateSyntax: userOptions.collections?.templateSyntax ?? "loop", pagination: { enabled: userOptions.collections?.pagination?.enabled ?? false, itemsPerPage: userOptions.collections?.pagination?.itemsPerPage ?? 10, routePattern: userOptions.collections?.pagination?.routePattern ?? "/{collection}/page/{page}" } },
    images: { enabled: userOptions.images?.enabled ?? false, formats: userOptions.images?.formats ?? ["webp", "jpg"], quality: { webp: userOptions.images?.quality?.webp ?? 85, avif: userOptions.images?.quality?.avif ?? 80, jpg: userOptions.images?.quality?.jpg ?? 85 }, responsive: { enabled: userOptions.images?.responsive?.enabled ?? false, breakpoints: userOptions.images?.responsive?.breakpoints ?? [640, 768, 1024, 1280, 1920], sizesAttribute: userOptions.images?.responsive?.sizesAttribute ?? "(max-width: 768px) 100vw, 50vw" }, lazyLoading: userOptions.images?.lazyLoading ?? true, compression: { enabled: userOptions.images?.compression?.enabled ?? true, maxWidth: userOptions.images?.compression?.maxWidth ?? 1920, maxHeight: userOptions.images?.compression?.maxHeight ?? 1080 } },
  };

  let root = process.cwd();
  let distDir = "dist";
  let isBuild = false;

  const siteUrl = normalizeUrl(options.site.url);

  const renderAll = async (isDev: boolean, server?: ViteDevServer): Promise<RenderResult[]> => {
    const pagesDirAbs = path.resolve(root, options.pagesDir);
    const partialsDirAbs = path.resolve(root, options.partialsDir);
    const markdownEnabled = options.markdown?.enabled ?? false;
    const pages = listPages(pagesDirAbs, markdownEnabled);

    const results: RenderResult[] = [];
    const manifest = isDev ? null : loadViteManifest(path.resolve(root, distDir));

    // Load collections data if enabled
    const collections = options.collections?.enabled ? loadCollectionsData(root, options.collections.dataFile || 'collections.json') : {};
    const allImagesToProcess: Array<{ src: string; formats: string[] }> = [];

    // First pass: collect all routes for link checking
    const allRoutes = pages.map(pageFileAbs => {
      const rel = toPosix(path.relative(pagesDirAbs, pageFileAbs));
      return routeFromRelPath(rel, options.cleanUrls, options.trailingSlash);
    });

    for (const pageFileAbs of pages) {
      const rel = toPosix(path.relative(pagesDirAbs, pageFileAbs));
      const route = routeFromRelPath(rel, options.cleanUrls, options.trailingSlash);
      const outFile = outFileFromRoute(route, path.resolve(root, distDir), options.cleanUrls);

      const raw = readText(pageFileAbs);
      const isMarkdown = pageFileAbs.toLowerCase().endsWith('.md');

      let parsedMeta: PageMeta;
      let rawBody: string;

      if (isMarkdown && markdownEnabled) {
        // Parse markdown with frontmatter
        const { meta, body } = parseMarkdownFrontmatter(raw);
        parsedMeta = meta;
        // Convert markdown to HTML
        rawBody = renderMarkdown(body, {
          gfm: options.markdown?.gfm,
          breaks: options.markdown?.breaks,
          pedantic: options.markdown?.pedantic,
        });
      } else {
        // Parse HTML with monad frontmatter
        const { meta, body } = tryParsePageMeta(raw);
        parsedMeta = meta;
        rawBody = body;
      }

      const { slots, rest } = extractSlotBlocks(rawBody);
      const pageBodyTemplate = rest;

      const meta: PageMeta = {
        ...parsedMeta,
        head: (parsedMeta.head ?? "") + (slots.head ? "\n" + slots.head : ""),
      };

      const title = meta.title ?? `${options.site.name ?? "Monad"} — ${route === "/" ? "Home" : route.replace(/\//g, " ").trim()}`;
      const description = meta.description ?? "Built with Monad.";

      const ctx = {
        site: options.site,
        page: { route, title, description, ...meta },
        data: {},
        collections: collections,
      };

      // Expand includes inside the page body
      // Skip final interpolation so collection loop variables ({{item.field}}) are preserved
      let renderedBody = expandIncludes({
        html: pageBodyTemplate,
        partialsDir: partialsDirAbs,
        ctx,
        skipFinalInterpolation: options.collections?.enabled ?? false
      });

      // Process collections if enabled
      if (options.collections?.enabled && Object.keys(collections).length > 0) {
        renderedBody = expandCollectionLoops(renderedBody, collections);
      }

      // Final mustache interpolation (after collections are processed)
      renderedBody = interpolateMustache(renderedBody, ctx);

      // Render layout
      const layoutRef = meta.layout ?? options.defaultLayout;
      const layoutPath = resolvePartial(partialsDirAbs, layoutRef);
      const layoutAbs = path.resolve(layoutPath);
      let layoutHtml = fs.existsSync(layoutAbs) ? readText(layoutAbs) : `<!doctype html><html><head>{{slot:head}}</head><body>{{slot:main}}</body></html>`;

      // Asset tags
      const assetTags = buildAssetTags({ isDev, manifest, entry: "src/entry.ts" });

      // OG image generation (optional) - per route generates /og/<slug>.png
      let ogImageAbs: string | undefined;
      const ogWarnings: string[] = [];
      if (!isDev && options.og?.enabled) {
        const outDir = path.join(path.resolve(root, distDir), options.og.outputDir || 'og');
        const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "_");
        const filename = options.og.mode === "single" ? "og.png" : `${slug}.png`;
        const ogOut = path.join(outDir, filename);

        const ogTitle = meta.og?.title ?? title;
        const ogSubtitle = meta.og?.subtitle ?? (options.site.name ?? "");

        const res = await tryGenerateOgImage({
          provider: options.og.provider || "og-gen" as const,
          title: ogTitle,
          subtitle: ogSubtitle,
          outPath: ogOut,
          width: options.og.width || 1200,
          height: options.og.height || 630,
        });

        if (res.ok) {
          const ogRel = "/" + toPosix(path.relative(path.resolve(root, distDir), ogOut));
          ogImageAbs = normalizeUrl(siteUrl) + ogRel;
        } else {
          ogWarnings.push(`OG image skipped: ${res.message ?? "unknown error"}`);
        }
      }

      const metaTags = buildMetaTags({
        siteUrl,
        route,
        title,
        description,
        locale: options.site.locale,
        twitterHandle: options.site.twitterHandle,
        ogImageAbs,
        themeColor: options.site.themeColor,
      });

      // Insert slots
      layoutHtml = layoutHtml.replaceAll("{{slot:main}}", renderedBody);
      layoutHtml = layoutHtml.replaceAll("{{slot:footer}}", "");

      // Build font optimization tags
      const fontOptimizationTags = options.fonts.enabled ? buildFontOptimizationTags({
        preconnect: options.fonts.preconnect,
        preload: options.fonts.preload,
        displayOptimization: options.fonts.displayOptimization
      }) : "";

      // Head slot composes meta + assets + font optimization + any page extra head
      const extraHead = (meta.head ?? "").trim();
      const headCombined = [metaTags, assetTags, fontOptimizationTags, extraHead].filter(Boolean).join("\n");
      if (layoutHtml.includes("{{slot:head}}")) {
        layoutHtml = layoutHtml.replaceAll("{{slot:head}}", headCombined);
      } else {
        layoutHtml = layoutHtml.replace(/<\/head>/i, headCombined + "\n</head>");
      }

      // Final pass: allow includes in layout too
      let renderedFull = expandIncludes({ html: layoutHtml, partialsDir: partialsDirAbs, ctx });

      // Apply performance hints if enabled and not in dev mode
      if (!isDev && options.performance.enabled) {
        renderedFull = applyPerformanceHints(renderedFull, {
          preloadCriticalCss: options.performance.preloadCriticalCss,
          addFetchPriority: options.performance.addFetchPriority,
          lazyLoadImages: options.performance.lazyLoadImages,
          threshold: options.performance.threshold,
        });
      }

      // Apply image optimization if enabled and not in dev mode
      if (!isDev && options.images.enabled) {
        const imageResult = generateResponsiveImages(renderedFull, {
          enabled: options.images?.responsive?.enabled ?? false,
          formats: options.images?.formats ?? ['webp'],
          breakpoints: options.images?.responsive?.breakpoints ?? [768, 1024],
          sizesAttribute: options.images?.responsive?.sizesAttribute ?? '100vw',
          quality: options.images?.quality ?? { webp: 80, jpg: 80 },
        });
        renderedFull = imageResult.html;
        allImagesToProcess.push(...imageResult.imagesToProcess);
      }

      // If dev, run through Vite HTML transform pipeline
      let finalHtml = server ? await server.transformIndexHtml(route, renderedFull) : renderedFull;

      // Apply HTML minification in production builds
      if (!isDev && options.minify.enabled) {
        finalHtml = await minifyHtml(finalHtml, {
          collapseWhitespace: options.minify.collapseWhitespace,
          removeComments: options.minify.removeComments,
          removeRedundantAttributes: options.minify.removeRedundantAttributes,
          removeEmptyAttributes: options.minify.removeEmptyAttributes,
          minifyCSS: options.minify.minifyCSS,
          minifyJS: options.minify.minifyJS,
        });
      }

      const warnings = [
        ...(options.audit.enabled ? auditHtml(finalHtml, route, !isDev ? {
          distDirAbs: path.resolve(root, distDir),
          maxImageBytes: options.audit?.maxImageBytes,
          allRoutes
        } : { allRoutes }) : []),
        ...(options.accessibility?.enabled ? auditAccessibility(finalHtml, route, {
          enabled: options.accessibility.enabled,
          mode: options.accessibility.mode ?? 'warn',
          rules: {
            headingHierarchy: options.accessibility.rules?.headingHierarchy ?? true,
            ariaAttributes: options.accessibility.rules?.ariaAttributes ?? true,
            colorContrast: options.accessibility.rules?.colorContrast ?? true,
            altText: options.accessibility.rules?.altText ?? true,
            keyboardNavigation: options.accessibility.rules?.keyboardNavigation ?? true,
            screenReader: options.accessibility.rules?.screenReader ?? true,
            skipLinks: options.accessibility.rules?.skipLinks ?? true,
            landmarkRoles: options.accessibility.rules?.landmarkRoles ?? true,
            tabIndex: options.accessibility.rules?.tabIndex ?? true,
            focusIndicators: options.accessibility.rules?.focusIndicators ?? true
          },
          colorContrast: {
            minimumRatio: options.accessibility.colorContrast?.minimumRatio ?? 4.5,
            checkLargeText: options.accessibility.colorContrast?.checkLargeText ?? true
          }
        }) : []),
        ...ogWarnings,
      ];

      results.push({
        route,
        outFile,
        html: finalHtml,
        warnings,
        meta: { title, description, ...meta },
      });
    }

    // Process all collected images if image optimization is enabled
    if (!isDev && options.images.enabled && allImagesToProcess.length > 0) {
      await processImages(allImagesToProcess, {
        quality: options.images?.quality ?? { webp: 80, jpg: 80 },
        compression: {
          enabled: options.images?.compression?.enabled ?? false,
          maxWidth: options.images?.compression?.maxWidth,
          maxHeight: options.images?.compression?.maxHeight
        },
        breakpoints: options.images?.responsive?.breakpoints ?? [768, 1024],
      }, root, distDir);
    }

    return results;
  };

  const render404 = async (isDev: boolean, server?: ViteDevServer, allRoutes?: string[]): Promise<RenderResult | null> => {
    if (!options.notFound?.enabled) return null;

    const pagesDirAbs = path.resolve(root, options.pagesDir);
    const partialsDirAbs = path.resolve(root, options.partialsDir);
    const templateName = options.notFound.template ?? "404.html";

    // Try to find the 404 template
    const templatePath = path.join(pagesDirAbs, templateName);
    if (!fs.existsSync(templatePath)) {
      // Create a default 404 template if none exists
      const defaultTemplate = `<!-- monad
{
  "title": "Page Not Found",
  "description": "The page you are looking for could not be found."
}
-->
<div style="text-align: center; padding: 2rem;">
  <h1>404 - Page Not Found</h1>
  <p>The page you are looking for could not be found.</p>
  <a href="/">Go back to home</a>
</div>`;

      const raw = defaultTemplate;
      const { meta: parsedMeta, body: rawBody } = tryParsePageMeta(raw);

      const { slots, rest } = extractSlotBlocks(rawBody);
      const pageBodyTemplate = rest;

      const meta: PageMeta = {
        ...parsedMeta,
        layout: options.notFound.layout ?? options.defaultLayout,
        head: (parsedMeta.head ?? "") + (slots.head ? "\n" + slots.head : ""),
      };

      const title = meta.title ?? "404 - Page Not Found";
      const description = meta.description ?? "The page you are looking for could not be found.";

      const ctx = {
        site: options.site,
        page: { route: "/404", title, description, ...meta },
        data: {},
      };

      // Expand includes inside the page body
      const renderedBody = expandIncludes({ html: pageBodyTemplate, partialsDir: partialsDirAbs, ctx });

      // Render layout
      const layoutRef = meta.layout ?? options.defaultLayout;
      const layoutPath = resolvePartial(partialsDirAbs, layoutRef);
      const layoutAbs = path.resolve(layoutPath);
      let layoutHtml = fs.existsSync(layoutAbs) ? readText(layoutAbs) : `<!doctype html><html><head>{{slot:head}}</head><body>{{slot:main}}</body></html>`;

      // Asset tags
      const manifest = isDev ? null : loadViteManifest(path.resolve(root, distDir));
      const assetTags = buildAssetTags({ isDev, manifest, entry: "src/entry.ts" });

      const metaTags = buildMetaTags({
        siteUrl,
        route: "/404",
        title,
        description,
        locale: options.site.locale,
        twitterHandle: options.site.twitterHandle,
        ogImageAbs: undefined,
        themeColor: options.site.themeColor,
      });

      // Insert slots
      layoutHtml = layoutHtml.replaceAll("{{slot:main}}", renderedBody);
      layoutHtml = layoutHtml.replaceAll("{{slot:footer}}", "");

      // Build font optimization tags
      const fontOptimizationTags = options.fonts.enabled ? buildFontOptimizationTags({
        preconnect: options.fonts.preconnect,
        preload: options.fonts.preload,
        displayOptimization: options.fonts.displayOptimization
      }) : "";

      // Head slot composes meta + assets + font optimization + any page extra head
      const extraHead = (meta.head ?? "").trim();
      const headCombined = [metaTags, assetTags, fontOptimizationTags, extraHead].filter(Boolean).join("\n");
      if (layoutHtml.includes("{{slot:head}}")) {
        layoutHtml = layoutHtml.replaceAll("{{slot:head}}", headCombined);
      } else {
        layoutHtml = layoutHtml.replace(/<\/head>/i, headCombined + "\n</head>");
      }

      // Final pass: allow includes in layout too
      let renderedFull = expandIncludes({ html: layoutHtml, partialsDir: partialsDirAbs, ctx });

      // Apply performance hints if enabled and not in dev mode
      if (!isDev && options.performance.enabled) {
        renderedFull = applyPerformanceHints(renderedFull, {
          preloadCriticalCss: options.performance.preloadCriticalCss,
          addFetchPriority: options.performance.addFetchPriority,
          lazyLoadImages: options.performance.lazyLoadImages,
          threshold: options.performance.threshold,
        });
      }

      // If dev, run through Vite HTML transform pipeline
      let finalHtml = server ? await server.transformIndexHtml("/404", renderedFull) : renderedFull;

      // Apply HTML minification in production builds
      if (!isDev && options.minify.enabled) {
        finalHtml = await minifyHtml(finalHtml, {
          collapseWhitespace: options.minify.collapseWhitespace,
          removeComments: options.minify.removeComments,
          removeRedundantAttributes: options.minify.removeRedundantAttributes,
          removeEmptyAttributes: options.minify.removeEmptyAttributes,
          minifyCSS: options.minify.minifyCSS,
          minifyJS: options.minify.minifyJS,
        });
      }

      const warnings = [
        ...(options.audit.enabled ? auditHtml(finalHtml, "/404", !isDev ? {
          distDirAbs: path.resolve(root, distDir),
          maxImageBytes: options.audit?.maxImageBytes,
          allRoutes
        } : { allRoutes }) : []),
        ...(options.accessibility?.enabled ? auditAccessibility(finalHtml, "/404", {
          enabled: options.accessibility.enabled,
          mode: options.accessibility.mode ?? 'warn',
          rules: {
            headingHierarchy: options.accessibility.rules?.headingHierarchy ?? true,
            ariaAttributes: options.accessibility.rules?.ariaAttributes ?? true,
            colorContrast: options.accessibility.rules?.colorContrast ?? true,
            altText: options.accessibility.rules?.altText ?? true,
            keyboardNavigation: options.accessibility.rules?.keyboardNavigation ?? true,
            screenReader: options.accessibility.rules?.screenReader ?? true,
            skipLinks: options.accessibility.rules?.skipLinks ?? true,
            landmarkRoles: options.accessibility.rules?.landmarkRoles ?? true,
            tabIndex: options.accessibility.rules?.tabIndex ?? true,
            focusIndicators: options.accessibility.rules?.focusIndicators ?? true
          },
          colorContrast: {
            minimumRatio: options.accessibility.colorContrast?.minimumRatio ?? 4.5,
            checkLargeText: options.accessibility.colorContrast?.checkLargeText ?? true
          }
        }) : []),
      ];

      return {
        route: "/404",
        outFile: path.join(path.resolve(root, distDir), "404.html"),
        html: finalHtml,
        warnings,
        meta: { title, description, ...meta },
      };
    }

    // Use existing template
    const raw = readText(templatePath);
    const { meta: parsedMeta, body: rawBody } = tryParsePageMeta(raw);

    const { slots, rest } = extractSlotBlocks(rawBody);
    const pageBodyTemplate = rest;

    const meta: PageMeta = {
      ...parsedMeta,
      layout: options.notFound.layout ?? options.defaultLayout,
      head: (parsedMeta.head ?? "") + (slots.head ? "\n" + slots.head : ""),
    };

    const title = meta.title ?? "404 - Page Not Found";
    const description = meta.description ?? "The page you are looking for could not be found.";

    const ctx = {
      site: options.site,
      page: { route: "/404", title, description, ...meta },
      data: {},
    };

    // Expand includes inside the page body
    const renderedBody = expandIncludes({ html: pageBodyTemplate, partialsDir: partialsDirAbs, ctx });

    // Render layout
    const layoutRef = meta.layout ?? options.defaultLayout;
    const layoutPath = resolvePartial(partialsDirAbs, layoutRef);
    const layoutAbs = path.resolve(layoutPath);
    let layoutHtml = fs.existsSync(layoutAbs) ? readText(layoutAbs) : `<!doctype html><html><head>{{slot:head}}</head><body>{{slot:main}}</body></html>`;

    // Asset tags
    const manifest = isDev ? null : loadViteManifest(path.resolve(root, distDir));
    const assetTags = buildAssetTags({ isDev, manifest, entry: "src/entry.ts" });

    const metaTags = buildMetaTags({
      siteUrl,
      route: "/404",
      title,
      description,
      locale: options.site.locale,
      twitterHandle: options.site.twitterHandle,
      ogImageAbs: undefined,
      themeColor: options.site.themeColor,
    });

    // Insert slots
    layoutHtml = layoutHtml.replaceAll("{{slot:main}}", renderedBody);
    layoutHtml = layoutHtml.replaceAll("{{slot:footer}}", "");

    // Head slot composes meta + assets + any page extra head
    const extraHead = (meta.head ?? "").trim();
    const headCombined = [metaTags, assetTags, extraHead].filter(Boolean).join("\n");
    if (layoutHtml.includes("{{slot:head}}")) {
      layoutHtml = layoutHtml.replaceAll("{{slot:head}}", headCombined);
    } else {
      layoutHtml = layoutHtml.replace(/<\/head>/i, headCombined + "\n</head>");
    }

    // Final pass: allow includes in layout too
    let renderedFull = expandIncludes({ html: layoutHtml, partialsDir: partialsDirAbs, ctx });

    // Apply performance hints if enabled and not in dev mode
    if (!isDev && options.performance.enabled) {
      renderedFull = applyPerformanceHints(renderedFull, {
        preloadCriticalCss: options.performance.preloadCriticalCss,
        addFetchPriority: options.performance.addFetchPriority,
        lazyLoadImages: options.performance.lazyLoadImages,
        threshold: options.performance.threshold,
      });
    }

    // If dev, run through Vite HTML transform pipeline
    let finalHtml = server ? await server.transformIndexHtml("/404", renderedFull) : renderedFull;

    // Apply HTML minification in production builds
    if (!isDev && options.minify.enabled) {
      finalHtml = await minifyHtml(finalHtml, {
        collapseWhitespace: options.minify.collapseWhitespace,
        removeComments: options.minify.removeComments,
        removeRedundantAttributes: options.minify.removeRedundantAttributes,
        removeEmptyAttributes: options.minify.removeEmptyAttributes,
        minifyCSS: options.minify.minifyCSS,
        minifyJS: options.minify.minifyJS,
      });
    }

    const warnings = [
      ...(options.audit.enabled ? auditHtml(finalHtml, "/404", !isDev ? {
        distDirAbs: path.resolve(root, distDir),
        maxImageBytes: options.audit?.maxImageBytes,
        allRoutes
      } : { allRoutes }) : []),
      ...(options.accessibility?.enabled ? auditAccessibility(finalHtml, "/404", {
        enabled: options.accessibility.enabled,
        mode: options.accessibility.mode ?? 'warn',
        rules: {
          headingHierarchy: options.accessibility.rules?.headingHierarchy ?? true,
          ariaAttributes: options.accessibility.rules?.ariaAttributes ?? true,
          colorContrast: options.accessibility.rules?.colorContrast ?? true,
          altText: options.accessibility.rules?.altText ?? true,
          keyboardNavigation: options.accessibility.rules?.keyboardNavigation ?? true,
          screenReader: options.accessibility.rules?.screenReader ?? true,
          skipLinks: options.accessibility.rules?.skipLinks ?? true,
          landmarkRoles: options.accessibility.rules?.landmarkRoles ?? true,
          tabIndex: options.accessibility.rules?.tabIndex ?? true,
          focusIndicators: options.accessibility.rules?.focusIndicators ?? true
        },
        colorContrast: {
          minimumRatio: options.accessibility.colorContrast?.minimumRatio ?? 4.5,
          checkLargeText: options.accessibility.colorContrast?.checkLargeText ?? true
        }
      }) : []),
    ];

    return {
      route: "/404",
      outFile: path.join(path.resolve(root, distDir), "404.html"),
      html: finalHtml,
      warnings,
      meta: { title, description, ...meta },
    };
  };

  return {
    name: "vite-plugin-monad",
    enforce: "post",

    config(config) {
      // Ensure manifest is enabled in build so we can inject hashed asset filenames.
      config.build ??= {};
      (config.build as any).manifest ??= true;
    },

    configResolved(resolved) {
      root = resolved.root;
      distDir = resolved.build.outDir;
      isBuild = resolved.command === "build";
    },

    configureServer(server) {
      // Serve Monad pages on clean routes, backed by /pages/*.html templates.
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url) return next();

          const url = req.url.split("?")[0] || "/";
          // Ignore Vite internals/assets
          if (url.startsWith("/@") || url.startsWith("/src/") || url.startsWith("/node_modules/") || url.includes(".")) {
            return next();
          }

          const results = await renderAll(true, server);
          const match = results.find(r => r.route === url || (options.trailingSlash && r.route === url + "/") || (!options.trailingSlash && r.route === url.replace(/\/$/, "")));

          if (!match) {
            // Try to serve 404 page if enabled
            const allRoutes = results.map(r => r.route);
            const notFoundResult = await render404(true, server, allRoutes);
            if (notFoundResult) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(notFoundResult.html);
              return;
            }
            return next();
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(match.html);
          return;
        } catch (err) {
          return next();
        }
      });
    },

    async closeBundle() {
      if (!isBuild) return;

      const results = await renderAll(false);

      // Write pages
      for (const r of results) {
        writeFileEnsured(r.outFile, r.html);
      }

      // Generate 404 page
      const allRoutes = results.map(r => r.route);
      const notFoundResult = await render404(false, undefined, allRoutes);
      if (notFoundResult) {
        writeFileEnsured(notFoundResult.outFile, notFoundResult.html);
        results.push(notFoundResult); // Include in audit reports
      }

      // Sitemap + robots
      const sitemapEnabled = options.sitemap?.enabled ?? true;
      if (sitemapEnabled) {
        const routes = results
          .map(r => ({ route: r.route, lastmod: new Date().toISOString().slice(0, 10) }))
          .filter(r => {
            const ex = options.sitemap?.exclude ?? [];
            return !ex.some(prefix => r.route.startsWith(prefix));
          });
        const sitemap = generateSitemap(siteUrl, routes, { changefreq: options.sitemap?.changefreq, priority: options.sitemap?.priority });
        writeFileEnsured(path.join(root, distDir, "sitemap.xml"), sitemap);
      }

      const robotsEnabled = options.robots?.enabled ?? true;
      if (robotsEnabled) {
        const robots = generateRobots(siteUrl, options.robots?.policy ?? "allowAll", options.robots?.disallow);
        writeFileEnsured(path.join(root, distDir, "robots.txt"), robots);
      }

      // Generate redirects files
      const redirectsEnabled = options.redirects?.enabled ?? false;
      if (redirectsEnabled && options.redirects?.rules && options.redirects.rules.length > 0) {
        const platform = options.redirects.platform ?? "both";

        if (platform === "netlify" || platform === "both") {
          const netlifyRedirects = generateNetlifyRedirects(options.redirects.rules);
          writeFileEnsured(path.join(root, distDir, "_redirects"), netlifyRedirects);
        }

        if (platform === "vercel" || platform === "both") {
          const vercelRedirects = generateVercelRedirects(options.redirects.rules);
          writeFileEnsured(path.join(root, distDir, "vercel.json"), vercelRedirects);
        }
      }

      // Audit report
      if (options.audit?.enabled) {
        const reportDir = path.join(root, distDir, "__monad");
        writeFileEnsured(path.join(reportDir, "report.json"), JSON.stringify({
          generatedAt: new Date().toISOString(),
          pages: results.map(r => ({ route: r.route, warnings: r.warnings, title: r.meta.title })),
          totals: {
            pages: results.length,
            warnings: results.reduce((a, r) => a + r.warnings.length, 0),
          }
        }, null, 2));
        writeFileEnsured(path.join(reportDir, "report.html"), htmlReport(results));

        const mode = options.audit?.mode ?? "warn";
        if (mode === "fail") {
          const totalWarnings = results.reduce((a, r) => a + r.warnings.length, 0);
          if (totalWarnings > 0) {
            throw new Error(`Monad audit failed: ${totalWarnings} warnings (see dist/__monad/report.html)`);
          }
        }
      }

      // Accessibility audit failure handling
      if (options.accessibility?.enabled) {
        const accessibilityMode = options.accessibility?.mode ?? "warn";
        if (accessibilityMode === "fail") {
          // Count only accessibility-related warnings
          const accessibilityWarnings = results.reduce((acc, r) => {
            const accessibilityOnlyWarnings = r.warnings.filter(warning =>
              warning.includes('h1') ||
              warning.includes('ARIA') ||
              warning.includes('aria-') ||
              warning.includes('role=') ||
              warning.includes('Alt text') ||
              warning.includes('alt attribute') ||
              warning.includes('tabindex') ||
              warning.includes('keyboard') ||
              warning.includes('focus') ||
              warning.includes('screen reader') ||
              warning.includes('landmark') ||
              warning.includes('skip link') ||
              warning.includes('contrast ratio') ||
              warning.includes('Button') ||
              warning.includes('Form input') ||
              warning.includes('table') ||
              warning.includes('List item') ||
              warning.includes('Interactive') ||
              warning.includes('heading hierarchy') ||
              warning.includes('multiple main')
            );
            return acc + accessibilityOnlyWarnings.length;
          }, 0);

          if (accessibilityWarnings > 0) {
            throw new Error(`Monad accessibility audit failed: ${accessibilityWarnings} accessibility warnings (see dist/__monad/report.html)`);
          }
        }
      }

      // Optional Lighthouse CI
      if (options.lighthouse?.enabled) {
        await runLighthouseAutorun(root, path.join(root, distDir));
      }
    }
  };
}
