import { defineConfig } from 'astro/config';

// User-level GitHub Pages site: served from the domain root, so no `base` is needed.
export default defineConfig({
  site: 'https://valegian.github.io',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
