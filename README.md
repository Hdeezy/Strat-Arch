# hopecard.ca build assets

Files pulled by the Vercel build for `hope-card-landing` (hopecard.ca). The build
downloads them by pinned commit and checks each SHA-256 before deploying, so a
changed or missing file fails the build instead of reaching the live site.

- `site/index.html`: homepage
- `site/numbers/index.html`: numbers and sources page
- `plates/`: homepage scroll scenes. `downtown-towers.webp` is a photo by
  Geoffrey Faber on Unsplash (Unsplash License); the other plates are AI renders
  of Hamilton, Ontario.

To change the site: commit new versions here, then update the pinned commit and
checksums in `scripts/fetch-plates.mjs` in the deployment.
