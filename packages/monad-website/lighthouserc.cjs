/**
 * Optional Lighthouse CI config.
 * Run: npm run build && npm run lhci
 */
module.exports = {
  ci: {
    collect: {
      staticDistDir: "dist",
      numberOfRuns: 1,
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.85 }],
        "categories:accessibility": ["warn", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "dist/__monad/lighthouse",
    },
  },
};
