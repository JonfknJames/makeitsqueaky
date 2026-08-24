# makeitsqueaky.com

The published site for Make it Squeaky — residential cleaning in Toronto.

Static files, served as-is. No build step, no bundler, no framework, and no
runtime dependency of any kind: open `index.html` from disk and the whole site
works, calculator included. Nothing on any page contacts a third party, so no
visitor's IP or user agent is handed to anyone. The webfont is vendored in
`assets/fonts/` for that reason rather than linked from a font CDN.

## What is here

| Path | What it is |
|---|---|
| `*.html` | The seven content pages plus `404.html` |
| `assets/css/site.css` | Every style. Design tokens are at the top, motion at the bottom |
| `assets/js/quote.js`, `area.js`, `estimator.js` | Pure pricing logic — no DOM, no fetch, no clock |
| `assets/js/quote-form.js`, `home-estimate.js`, `ui.js` | The only files that touch the DOM |
| `data/pricing.json` | The rate card. Prices are data, never code |
| `CNAME` | Custom domain for GitHub Pages |

## Changing a price

Edit `data/pricing.json`. Nothing else. The calculator, the home page
estimate and the published rates all read from it.

The pages do repeat the rates as text, which is what stops them being useful
if they drift — so the development repo carries a test suite that fails when a
published number and the rate card disagree. Make price changes there, not
here.

## Deploying

This repo *is* the deploy target. GitHub Pages serves the default branch from
the root, and `404.html` is picked up automatically so unknown URLs return a
real 404 rather than a soft 200.

Development happens in a separate private repository; this one receives
snapshots of the finished site.
