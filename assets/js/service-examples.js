// assets/js/service-examples.js — worked example prices under each service
// panel on pricing.html.
//
// A rate per square foot is honest and useless on its own: nobody knows what
// "$0.40 / sq ft" costs them until they multiply. This fills each panel with
// three typical homes — the same shortlist the estimator card offers — and
// the number the engine gives for each, so the visitor reads "Deep Cleaning,
// two-bedroom condo, about 950 sq ft, $380" and can place their own home
// between the rows.
//
// Every figure comes from data/pricing.json through the same pure modules as
// the calculator. Nothing here is typed into the HTML: a price written into
// markup is right until the next rate change and silently wrong after it,
// and tests/copy-rules.test.js cannot guard a figure it has no rule for.
// The blocks ship hidden and empty; without JavaScript the panel is the rate,
// the inclusions, and a link to the calculator, which is still complete.
//
// exampleRows() and parseSizes() are exported and pure so the unit suite can
// hold them; the DOM wiring below only runs in a browser.
import { quote } from './quote.js';
import { estimateSqFt, decodeSize } from './estimator.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-CA')}`;

/**
 * "condo|2|1=Two-bedroom condo;house|4|3=Four-bedroom house" → [{value,label}]
 * A pair without "=" is dropped rather than guessed at.
 */
export function parseSizes (attr) {
  return String(attr || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) return null;
      const value = pair.slice(0, i).trim();
      const label = pair.slice(i + 1).trim();
      return value && label ? { value, label } : null;
    })
    .filter(Boolean);
}

/**
 * One row per size the engine will price for this service. A size the
 * service refuses (above its ceiling, or a home type the rate card has
 * dropped) is left out, not shown with a made-up figure.
 */
export function exampleRows (service, sizes, pricing) {
  const rows = [];
  if (!pricing || !pricing.services[service]) return rows;
  for (const { value, label } of sizes) {
    const size = decodeSize(value);
    if (!size || !pricing.sqFtEstimator[size.homeType]) continue;
    const sqFt = Math.round(estimateSqFt(size, pricing));
    // No postal code, no add-ons, no condition answers: the floor for a home
    // of this size, which is why the copy under the rows says "before
    // add-ons and travel".
    const r = quote({ service, sqFt, addOns: {}, conditionFlags: [] }, pricing);
    if (r.quoteOnly) continue;
    rows.push({ label, sqFt, total: r.total, minimumApplied: r.minimumApplied });
  }
  return rows;
}

function renderBlock (block, pricing) {
  const service = block.dataset.service;
  const sizes = parseSizes(block.dataset.sizes);
  const list = block.querySelector('.ms-examples__list');
  if (!list) return;
  const rows = exampleRows(service, sizes, pricing);
  if (!rows.length) return;

  list.textContent = '';
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'ms-examples__row';

    const home = document.createElement('span');
    home.className = 'ms-examples__home';
    home.textContent = row.label;

    const basis = document.createElement('span');
    basis.className = 'ms-examples__basis';
    basis.textContent = row.minimumApplied
      ? `about ${row.sqFt.toLocaleString('en-CA')} sq ft · minimum job applies`
      : `about ${row.sqFt.toLocaleString('en-CA')} sq ft`;

    const price = document.createElement('strong');
    price.className = 'ms-examples__price';
    price.textContent = money(row.total);

    li.append(home, basis, price);
    list.appendChild(li);
  }
  block.hidden = false;
}

async function init () {
  const blocks = [...document.querySelectorAll('.ms-examples[data-service]')];
  if (!blocks.length) return;
  let pricing;
  try {
    const res = await fetch(new URL('../../data/pricing.json', import.meta.url));
    if (!res.ok) throw new Error(`pricing fetch failed: ${res.status}`);
    pricing = await res.json();
  } catch {
    return; // the panels stay complete without the examples
  }
  for (const block of blocks) renderBlock(block, pricing);

  // The examples land AFTER the browser has already scrolled to any #anchor
  // in the URL, and they add several hundred pixels above the fees section.
  // A visitor who followed "Add-ons & fees" was standing on the heading and
  // is now standing on the panel above it. Put them back where they asked to
  // be. Instant, not smooth: this is a correction of a landing that already
  // happened, not a new navigation, and [id] scroll-margin-top still clears
  // the sticky header because scrollIntoView honours it.
  if (window.location.hash.length > 1) {
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) {
      window.requestAnimationFrame(() => target.scrollIntoView({ behavior: 'instant', block: 'start' }));
    }
  }
}

if (typeof document !== 'undefined') init();
