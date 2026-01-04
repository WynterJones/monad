---
title: Markdown Demo - Monad
description: Showcasing Monad's GitHub Flavored Markdown support with smart typography
layout: layout.html
---

# Markdown Demo

This page demonstrates Monad's powerful Markdown support with GitHub Flavored Markdown and smart typography enhancements.

## GitHub Flavored Markdown

### Tables

| Feature | Status | Performance Impact |
|---------|--------|--------------------|
| Markdown | Enabled | None |
| Smart Quotes | Enabled | None |
| Syntax Highlighting | Optional | Minimal |

### Task Lists

- [x] Support for GFM
- [x] Smart typography
- [x] YAML frontmatter
- [ ] MDX components (future)

### Strikethrough

~~Old feature~~ has been replaced with **new improved feature**!

### Code Blocks with Syntax Highlighting

```javascript
// Monad configuration example
export default defineConfig({
  plugins: [
    monad({
      markdown: {
        enabled: true,
        gfm: true,
        smartypants: true
      }
    })
  ]
})
```

## Smart Typography

Monad automatically enhances your typography:

- "Smart quotes" instead of "straight quotes"
- Em dashes --- like this one
- Ellipsis... automatically converted
- (c) becomes © and (tm) becomes ™

## Extended Features

### Footnotes

Here's a sentence with a footnote[^1].

[^1]: This is the footnote content.

### Definition Lists

Monad
: A fast, modern static site generator built on Vite

SSG
: Static Site Generator - pre-builds HTML at build time

### Abbreviations

The HTML specification is maintained by the W3C.

*[HTML]: HyperText Markup Language
*[W3C]: World Wide Web Consortium

## Blockquotes

> "The best static site generator is the one that gets out of your way and lets you build."
>
> --- The Monad Team

### Nested Blockquotes

> This is the first level of quoting.
>
> > This is nested blockquote.
>
> Back to the first level.

## Advanced Code Examples

```html
<!-- Using Monad partials in Markdown -->
<% feature_card.html, {
  "title": "Markdown Support",
  "desc": "Write content in Markdown with full GFM support"
} %>
```

## Links and References

- [Monad GitHub Repository](https://github.com/WynterJones/monad)
- [Vite Documentation](https://vitejs.dev)
- [Markdown Guide][1]

[1]: https://www.markdownguide.org/

---

**Note:** This page itself is written in Markdown and processed by Monad!