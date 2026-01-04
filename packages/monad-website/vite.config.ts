import { defineConfig } from "vite";
import monad from "@wynterai/vite-plugin-monad";

export default defineConfig({
  plugins: [
    monad({
      pagesDir: "pages",
      partialsDir: "partials",
      site: {
        url: "https://example.com",
        name: "Monad",
        locale: "en_US",
        themeColor: "#0b1220",
      },
      sitemap: { enabled: true },
      robots: { enabled: true, policy: "allowAll" },
      audit: { enabled: true, mode: "warn" },

      // Phase 1 Features
      notFound: {
        enabled: true,
        template: "404.html"
      },
      redirects: {
        enabled: true,
        platform: "both",
        rules: [
          { from: "/old-about", to: "/about", status: 301 },
          { from: "/contact-us", to: "/contact", status: 301 }
        ]
      },
      markdown: {
        enabled: true,
        gfm: true,
        smartypants: true
      },

      // Phase 2 Features: Performance & Optimization
      minify: {
        enabled: true,
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        minifyCSS: true,
        minifyJS: true,
      },
      performance: {
        enabled: true,
        preloadCriticalCss: true,
        addFetchPriority: true,
        lazyLoadImages: true,
        threshold: 600,
      },
      fonts: {
        enabled: true,
        preconnect: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        preload: [
          {
            href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
            as: "font",
            type: "text/css",
            crossorigin: "anonymous"
          }
        ],
        displayOptimization: "swap"
      },

      // Phase 3 Features: Content Management & Advanced Features
      collections: {
        enabled: true,
        dataFile: "collections.json",
        templateSyntax: "loop",
        pagination: {
          enabled: false,
          itemsPerPage: 10,
          routePattern: "/{collection}/page/{page}"
        }
      },
      images: {
        enabled: true,
        formats: ["webp", "jpg"],
        quality: {
          webp: 85,
          avif: 80,
          jpg: 85
        },
        responsive: {
          enabled: true,
          breakpoints: [640, 768, 1024, 1280, 1920],
          sizesAttribute: "(max-width: 768px) 100vw, 50vw"
        },
        lazyLoading: true,
        compression: {
          enabled: true,
          maxWidth: 1920,
          maxHeight: 1080
        }
      },

      // Optional (off by default):
      // og: { enabled: true, provider: "og-gen", mode: "per-route" },
      // lighthouse: { enabled: true, mode: "autorun" },
    }),
  ],
  build: {
    // Monad generates HTML itself; Vite just bundles assets (manifest needed).
    manifest: true,
    rollupOptions: {
      input: "src/entry.ts",
    }
  }
});
