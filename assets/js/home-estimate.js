// assets/js/home-estimate.js — DOM wiring for the home page's price preview.
//
// Same split as quote-form.js: this file reads two selects and renders what
// the engine returns. It never does arithmetic on a price, and it never
// carries a rate of its own — every figure it shows comes from
// data/pricing.json through quote() and estimateSqFt().
//
// Why the home page prices at all: the site's promise is "priced by the square
// foot, settled before she arrives". The card that used to sit here made that
// promise and then asked the visitor to click through to find out — it was a
// styled link wearing a form's clothes. Answering the question where it is
// asked is the difference between a claim and a demonstration.
import { quote } from './quote.js';
import { estimateSqFt, decodeSize } from './estimator.js';

const form = document.getElementById('quote-start');
const serviceSelect = document.getElementById('quote-service');
const sizeSelect = document.getElementById('quote-size');
const result = document.getElementById('quote-start-result');
const amountEl = document.getElementById('quote-start-amount');
const unitEl = document.getElementById('quote-start-unit');
const basisEl = document.getElementById('quote-start-basis');

const money = (n) => `$${Math.round(n).toLocaleString('en-CA')}`;

let pricing = null;

function render () {
  const size = decodeSize(sizeSelect.value);
  const service = serviceSelect.value;

  // Either half of the pair can be missing on a page served from a stale
  // cache, or if someone edits the markup. Showing nothing is right: the
  // button still goes to the calculator, which is where a price it cannot
  // work out here gets worked out properly.
  if (!size || !service || !pricing.services[service] || !pricing.sqFtEstimator[size.homeType]) {
    result.hidden = true;
    return;
  }

  const sqFt = Math.round(estimateSqFt(size, pricing));

  // No postal code, no add-ons, no condition answers — so this is the floor
  // for a home of this size, not the price. quote() treats an absent postal
  // code as "no travel derived yet" rather than as a $0 fee, which is exactly
  // the reading we want on a page that has not asked where the home is.
  const estimate = quote(
    { service, sqFt, addOns: {}, conditionFlags: [] },
    pricing,
  );

  // quoteOnly can only happen here if the rate card's maxSqFt drops below the
  // largest home in the shortlist. There is no number to show in that case,
  // and inventing one would be worse than the click-through this replaces.
  if (estimate.quoteOnly) {
    result.hidden = true;
    return;
  }

  amountEl.textContent = money(estimate.total);
  unitEl.textContent = `${estimate.unit} visit`;
  basisEl.textContent =
    `Based on about ${sqFt.toLocaleString('en-CA')} sq ft, before add-ons and travel.`;
  result.hidden = false;
}

async function init () {
  if (!form || !serviceSelect || !sizeSelect || !result) return;

  try {
    // Resolved against THIS module's URL for the same reason quote-form.js
    // does it: a root-absolute path breaks the moment the site is served from
    // a subpath.
    const res = await fetch(new URL('../../data/pricing.json', import.meta.url));
    if (!res.ok) throw new Error(`pricing fetch failed: ${res.status}`);
    pricing = await res.json();
  } catch {
    // The card stays exactly what it is without JavaScript — two choices and
    // a button through to the calculator. A price preview is an enhancement;
    // losing it must never cost the visitor the path to a real quote.
    return;
  }

  form.addEventListener('change', render);
  render();
}

init();
