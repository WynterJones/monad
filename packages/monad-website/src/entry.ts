// Monad example entry.
// Vite bundles this and outputs a manifest; Monad injects correct hashed filenames into generated HTML.
import "./styles.css";

const yearEl = document.querySelector("[data-year]");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
