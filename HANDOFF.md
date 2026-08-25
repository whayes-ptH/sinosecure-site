# Sino Secure — Project Handoff

Handoff notes for the production website at **sinosecure.eu**. Everything a new
maintainer needs to run, change, and deploy the site is below.

---

## 1. What this is

A four-page marketing and lead-capture site for Sino Secure, a specialty
insurance business (marine and cargo, financial guarantee, indemnity and
liability, specialty risk). The only interactive element is an underwriting
enquiry form; there is no application logic, no database, no authentication
and no user accounts.

| | |
|---|---|
| Framework | Next.js 16.3.1, App Router, React 19.2 |
| Language | TypeScript 7.0 (strict via `tsconfig.json`) |
| Styling | Tailwind CSS 4.3 (`@import "tailwindcss"`) plus hand-written CSS in `src/app/globals.css` |
| Hosting | Netlify — project slug `sinosecure-site` |
| Runtime | Node 22 (pinned in `netlify.toml`) |
| Forms | Netlify Forms, form name `sino-underwriting` |

---

## 2. Repository map

```
netlify.toml            Build command, Node version, security headers, www redirect
next.config.ts          poweredByHeader off, React strict mode on
src/app/
  layout.tsx            Root layout, site-wide metadata, Header + Footer
  globals.css           The entire design system (~167 lines) — see §4
  page.tsx              Home page: hero, intro, solutions, sectors, network, CTA
  contact/page.tsx      Enquiry page — office details + ContactForm
  thank-you/page.tsx    Post-submit confirmation page
  privacy-policy/       Legal copy
  terms-of-service/     Legal copy
  sitemap.ts            Generates /sitemap.xml for the four public pages
  robots.ts             Generates /robots.txt, points at the sitemap
src/components/
  Header.tsx            Sticky translucent nav; mobile menu is a <details> element
  Footer.tsx            Four-column footer with legal links and office address
  Logo.tsx              Inline SVG wordmark, links home
  ContactForm.tsx       The Netlify form (see §3)
public/
  __forms.html          Static form copy so Netlify can detect the form (see §3)
  hero.webp             Home page hero image
  favicon.svg
```

Source is written in a deliberately dense style — most components are a single
returned JSX expression on one long line. Match that style when editing so
diffs stay readable against what is already there.

---

## 3. The contact form — read this before touching it

This is the one part of the site with a non-obvious mechanism, and the one
most likely to break silently.

Netlify detects forms by scanning **static HTML at deploy time**. A Next.js
App Router page is server-rendered, so Netlify never sees the JSX form in
`ContactForm.tsx`. That is why `public/__forms.html` exists: it is a hidden,
static duplicate of the form that exists solely to be detected. It is not
linked from anywhere and is never shown to a visitor.

**The two files must stay in sync.** If you add, rename or remove a field in
`src/components/ContactForm.tsx`, make the same change in
`public/__forms.html`, or submissions for that field will be dropped.

Current fields: `name`, `email`, `company`, `interest` (select), `message`,
plus `company-website` as the honeypot declared via `data-netlify-honeypot`.

Other details worth knowing:

- The form posts to `/thank-you`, which is why that page exists as a real route
  rather than a client-side state change.
- The hidden `form-name` input carrying `sino-underwriting` is required — Netlify
  uses it to route the submission. Do not remove it.
- Submissions land in the Netlify UI under **Forms → sino-underwriting**. Nothing
  emails them anywhere by default; notification recipients have to be configured
  in the Netlify dashboard, and it is worth confirming someone is actually
  receiving them.
- Form detection has to be enabled on the Netlify project. If submissions stop
  appearing after a deploy, check that setting first, then check whether
  `__forms.html` survived the build.
- The form carries a visible disclaimer that submitting does not bind coverage.
  Keep it. It is there for regulatory reasons, not decoration.

---

## 4. Styling

There is no component library and no CSS modules. `src/app/globals.css` holds
the whole design system: CSS custom properties for the palette at the top, then
plain class selectors used directly in the JSX (`.hero`, `.capability-grid`,
`.portfolio-list`, `.cta-band`, and so on).

Palette tokens live in `:root` — `--ink` `#071d31`, `--ink-2` `#0d3047`,
`--gold` `#db6f3d`, `--paper` `#f2f6f7`, `--muted` `#66717d`. Change a brand
colour in one place there rather than in individual rules.

Type is set with `clamp()` for fluid scaling, so headings resize without
breakpoints. Tailwind is imported and available, but the existing markup barely
uses utility classes — prefer extending `globals.css` in the same idiom over
introducing a parallel utility-class style.

Note that fonts are system stacks (`Helvetica Neue`, Arial). If a custom
typeface is ever licensed, `--display` and `--sans` are the two variables to
change.

---

## 5. Running it locally

```bash
npm install
npm run dev        # Next dev server with Turbopack
npm run typecheck  # tsc --noEmit — run this before pushing
npm run build      # production build
```

To exercise Netlify features locally — form handling in particular — use the
Netlify CLI instead of `npm run dev`, since the plain dev server has no form
backend:

```bash
netlify dev --port 8889
```

There is no test suite and no linting step configured. `npm run typecheck` is
the only automated check, so run it.

---

## 6. Deployment

Netlify builds from the repository using the committed `netlify.toml`:
`npm run build`, publishing `.next`, on Node 22. There is no manual deploy step
and no environment variables are required — the site has no secrets, no API
keys and no backend services.

`netlify.toml` also carries two things worth preserving:

- **Security headers** on every route: `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, and a `Permissions-Policy` denying camera,
  microphone and geolocation.
- **A 301 redirect** from `www.sinosecure.eu` to the apex domain, forced. The
  apex is canonical; SEO metadata, the sitemap and `metadataBase` all assume it.

`NETLIFY_NEXT_SKEW_PROTECTION` is enabled, which keeps clients on a consistent
build during rollouts.

---

## 7. SEO and metadata

`metadataBase` is set to `https://sinosecure.eu` in `layout.tsx`, with a title
template of `%s | Sino Secure` and an Open Graph image pointing at
`/hero.webp`. Per-page titles are set in each page's exported `metadata`.

`sitemap.ts` enumerates the four public routes explicitly. **If you add a page,
add it to that array** — it is a hardcoded list, not a filesystem crawl. The
thank-you page is deliberately excluded.

---

## 8. Open items for whoever picks this up

None of these are broken; they are the decisions and checks left outstanding.

1. **Confirm form notifications have a recipient.** Enquiries are commercial
   leads. Silent form submissions are the highest-consequence failure mode this
   site has.
2. **Verify DNS and the domain alias.** The apex should be primary with `www` as
   an alias, so the redirect in `netlify.toml` behaves as intended.
3. **Have the legal pages reviewed.** The privacy policy and terms of use are
   drafted but should be signed off by someone qualified, particularly given the
   Australian business entity and the `.eu` domain — GDPR obligations around the
   personal data collected by the enquiry form are the specific question.
4. **The business address is Australian** (Suite 7, 334 Highbury Road, Mount
   Waverley VIC 3149) and appears in both the footer and the contact page.
   Update both if it changes.
5. **No analytics are installed.** If lead attribution matters, that is a
   deliberate gap to fill.
6. **No test suite or CI checks.** Reasonable for a site this size, but worth
   adding a typecheck step to CI if the site grows.
7. **The footer copyright year is computed at render time** via
   `new Date().getFullYear()`, so it does not need annual maintenance.
