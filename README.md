# Sino Secure

Production website for [sinosecure.eu](https://sinosecure.eu), built with Next.js App Router, TypeScript and Tailwind CSS for Netlify.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Netlify launch

1. Import the GitHub repository into Netlify.
2. Use the committed `netlify.toml` settings.
3. Enable Forms detection and redeploy; submissions appear as `sino-underwriting`.
4. Add `sinosecure.eu` as primary and `www.sinosecure.eu` as an alias.
5. Verify form handling, HTTPS, redirects, sitemap, legal pages and social preview before DNS cutover.
