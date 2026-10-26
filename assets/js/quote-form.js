// assets/js/quote-form.js — DOM wiring for the quote request.
//
// The form collects what Tiffany needs to quote a job — service, where, how
// big, extras, and three questions about the home's condition — and hands it
// to her on WhatsApp, written out. It shows NO price: Tiffany quotes every
// job personally (her decision, 2026-10-26, recorded in PRODUCT.md), and the
// rate card is hers, not the browser's. Nothing in this file, or in anything
// the browser downloads, knows what a clean costs.
//
// Pure helpers do the two pieces of real logic: area.js places the postal
// code, estimator.js turns room counts into square footage. This file reads
// the form, calls them, and renders.
import { serviceArea } from './area.js';
import { estimateSqFt, decodeSize } from './estimator.js';

const HOME_TYPE_LABELS = {
  condo: 'condo/apartment',
  townhouse: 'townhouse',
  house: 'house',
};

// Elements (all present in quote.html — see markup for ids).
const form = document.getElementById('quote-form');
const summaryBody = document.getElementById('quote-summary-body');

const postalInput = document.getElementById('quote-postal');
const postalStatusText = document.getElementById('postal-status-text');

const sqftInput = document.getElementById('quote-sqft');
const unsureToggle = document.getElementById('quote-unsure-toggle');
const estimatorPanel = document.getElementById('quote-estimator');
const homeTypeSelect = document.getElementById('quote-hometype');
const bedroomsInput = document.getElementById('quote-bedrooms');
const bathroomsInput = document.getElementById('quote-bathrooms');
const estimateNote = document.getElementById('quote-estimate-note');
const estimateNoteText = document.getElementById('quote-estimate-note-text');

const windowsToggle = document.getElementById('addon-windows-toggle');
const windowsCount = document.getElementById('addon-windows-count');
const appliancesToggle = document.getElementById('addon-appliances');
const appliancesCount = document.getElementById('addon-appliances-count');

// The summary re-renders on every keystroke, so the panel itself is NOT a
// live region — announcing the whole thing per character is unusable with a
// screen reader. One short debounced sentence goes here instead.
const liveRegion = document.getElementById('quote-live');

// The phone bar (quote.html, mobile.css). The summary panel sits several
// screens below the last question at phone width, so the bar mirrors its
// one-line state and jumps to it. Hidden while the panel itself is on screen.
// site.css keeps it display:none at desktop width.
const bar = document.getElementById('quote-bar');
const barLabel = document.getElementById('quote-bar-label');
const barValue = document.getElementById('quote-bar-value');
const summaryPanel = document.getElementById('quote-summary');

function setBar (label, value) {
  if (!bar) return;
  barLabel.textContent = label;
  barValue.textContent = value;
}

// Rect maths on a rAF-throttled scroll handler, not IntersectionObserver —
// the same reasoning as the reveal in ui.js: measured on WebKit, the observer
// reported elements squarely in view as not intersecting.
let barFrame = 0;
function syncBar () {
  if (!bar || !summaryPanel) return;
  const r = summaryPanel.getBoundingClientRect();
  bar.hidden = r.top < window.innerHeight && r.bottom > 0;
}
function scheduleBarSync () {
  if (barFrame) return;
  barFrame = window.requestAnimationFrame(() => { barFrame = 0; syncBar(); });
}

const ANNOUNCE_DELAY_MS = 700;
let announceTimer = null;
function announce (text) {
  if (!liveRegion) return;
  if (announceTimer !== null) window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => { liveRegion.textContent = text; }, ANNOUNCE_DELAY_MS);
}

if (form) form.addEventListener('submit', (e) => e.preventDefault());

let catalog = null;

// "a, b" reads as a broken sentence; the list is spoken by a screen reader
// and read as a sentence by everyone else, so it needs the conjunction.
function listSentence (items) {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function readAddOns () {
  const chosen = [];
  if (document.getElementById('addon-oven').checked) chosen.push(catalog.addOns.oven.label);
  if (document.getElementById('addon-fridge').checked) chosen.push(catalog.addOns.fridge.label);
  const windows = windowsToggle.checked ? (Number(windowsCount.value) || 0) : 0;
  if (windows > 0) chosen.push(`${catalog.addOns.interiorWindows.label} × ${windows}`);
  if (document.getElementById('addon-cabinets').checked) chosen.push(catalog.addOns.cabinets.label);
  if (document.getElementById('addon-wallwashing').checked) chosen.push(catalog.addOns.wallWashing.label);
  const appliances = appliancesToggle.checked ? (Number(appliancesCount.value) || 0) : 0;
  if (appliances > 0) chosen.push(`${catalog.addOns.appliances.label} × ${appliances}`);
  return chosen;
}

// Every condition question is asked so that "yes" means the thing is there.
// An UNANSWERED question is not a "no": until all three are answered the
// request is not ready, and the summary says which are missing.
function readConditions () {
  const answers = [];
  let unanswered = 0;
  for (const [key, cfg] of Object.entries(catalog.conditions)) {
    const checked = form.querySelector(`input[name="condition-${key}"]:checked`);
    if (!checked) { unanswered += 1; continue; }
    answers.push({ label: cfg.label, yes: checked.value === 'yes' });
  }
  return { answers, unanswered };
}

// What the square footage rests on, in the customer's words: typed, or
// estimated from the home they described. Tiffany should know which.
function describeSize (sqFt) {
  const size = `${sqFt.toLocaleString('en-CA')} sq ft`;
  if (!unsureToggle.checked) return size;
  const beds = Number(bedroomsInput.value) || 0;
  const baths = Number(bathroomsInput.value) || 0;
  return `about ${size} (estimated: ${HOME_TYPE_LABELS[homeTypeSelect.value]}, ${beds} bedroom${beds === 1 ? '' : 's'}, ${baths} bathroom${baths === 1 ? '' : 's'})`;
}

function areaSentence (area) {
  if (area.status === 'served') return `${area.label}`;
  if (area.status === 'byRequest') return `${area.label}, by request`;
  return 'outside the usual area, asking anyway';
}

function buildWhatsAppLink ({ serviceLabel, sqFt, addOns, postal, area, conditions }) {
  // "Quote", never "book": nothing here books anything. Tiffany reads this,
  // works out the price, and agrees the day with the customer herself.
  const yes = conditions.filter((c) => c.yes).map((c) => c.label.toLowerCase());
  const lines = [
    "Hi Tiffany! Could you quote this for me?",
    `- Service: ${serviceLabel}`,
    `- Home: ${describeSize(sqFt)}`,
    `- Postal code: ${postal} (${areaSentence(area)})`,
    `- Add-ons: ${addOns.length ? addOns.join(', ') : 'none'}`,
    `- Worth mentioning: ${yes.length ? listSentence(yes) : 'nothing out of the ordinary'}`,
    'Sent from makeitsqueaky.com',
  ];
  // minimal: no backend in this phase, so the request goes to WhatsApp, where
  // Tiffany already runs her business. Upgrade path: a POST to /api/quote
  // that stores the request and messages her.
  return `https://wa.me/14165642125?text=${encodeURIComponent(lines.join('\n'))}`;
}

function noteEl (text) {
  const div = document.createElement('div');
  div.className = 'ms-note';
  div.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v4.5M10 6.75v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const p = document.createElement('p');
  p.textContent = text;
  div.appendChild(p);
  return div;
}

function ctaRow (whatsAppHref) {
  const wrap = document.createElement('div');
  wrap.className = 'ms-quote-cta';

  const wa = document.createElement('a');
  wa.className = 'ms-btn ms-btn--accent';
  wa.href = whatsAppHref;
  wa.target = '_blank';
  wa.rel = 'noopener noreferrer';
  wa.textContent = 'Send to Tiffany on WhatsApp';
  wa.dataset.testid = 'quote-send';
  const hint = document.createElement('span');
  hint.className = 'ms-visually-hidden';
  hint.textContent = ' (opens in a new tab)';
  wa.appendChild(hint);
  wrap.appendChild(wa);

  // For anyone without WhatsApp. A phone link on purpose: someone who has just
  // described their home wants a quote, and a text reaches Tiffany between
  // jobs where an inbox does not.
  const tel = document.createElement('a');
  tel.className = 'ms-btn ms-btn--ghost';
  tel.href = 'tel:+14165642125';
  tel.textContent = 'Or call/text (416) 564-2125';
  wrap.appendChild(tel);

  return wrap;
}

// The form is `novalidate`: the summary builds as you type rather than on
// submit, so THIS is what stands between a half-filled form and a request
// that reaches Tiffany missing the one thing she needs. Every gap is named
// and linked to its step.
function renderIncomplete (missing) {
  summaryBody.innerHTML = '';

  const heading = document.createElement('p');
  heading.className = 'ms-quote-outcome__heading';
  heading.textContent = 'A few more answers and your request is ready.';
  heading.dataset.testid = 'quote-incomplete';
  summaryBody.appendChild(heading);

  const note = noteEl('');
  note.querySelector('p').remove();
  const textWrap = document.createElement('div');
  const introP = document.createElement('p');
  introP.innerHTML = '<strong>Still needed:</strong>';
  textWrap.appendChild(introP);
  const ul = document.createElement('ul');
  ul.className = 'ms-quote-outcome__reasons';
  for (const item of missing) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = item.href;
    a.textContent = item.text;
    li.appendChild(a);
    ul.appendChild(li);
  }
  textWrap.appendChild(ul);
  note.appendChild(textWrap);
  summaryBody.appendChild(note);

  announce(`Your request isn't ready yet. Still needed: ${missing.map((m) => m.text).join('; ')}.`);
}

function row (dl, term, detail) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = detail;
  dl.append(dt, dd);
}

function renderReady (ctx) {
  summaryBody.innerHTML = '';

  const dl = document.createElement('dl');
  dl.className = 'ms-request';
  dl.dataset.testid = 'quote-request';
  row(dl, 'Service', ctx.serviceLabel);
  // "1,400 sq ft" is one token on a phone: the figure and its unit never part.
  row(dl, 'Home', describeSize(ctx.sqFt).replace(/(\d) sq ft/g, (m, d) => d + '\u00a0sq\u00a0ft'));
  row(dl, 'Postal code', `${ctx.postal} · ${ctx.area.status === 'served' ? ctx.area.label : ctx.area.status === 'byRequest' ? 'GTA, by request' : 'outside the usual area'}`);
  row(dl, 'Add-ons', ctx.addOns.length ? ctx.addOns.join(', ') : 'None');
  const yes = ctx.conditions.filter((c) => c.yes).map((c) => c.label);
  row(dl, 'Worth mentioning', yes.length ? listSentence(yes) : 'Nothing out of the ordinary');
  summaryBody.appendChild(dl);

  summaryBody.appendChild(noteEl('Tiffany quotes every job herself. Nothing is booked or charged here — she comes back to you with a price, and you agree the day together.'));

  summaryBody.appendChild(ctaRow(buildWhatsAppLink(ctx)));

  announce('Your request is ready. Send it to Tiffany on WhatsApp, or call or text her.');
}

// Status line under the postal code. Three honest sentences, no fee.
function updatePostalStatus (postalRaw) {
  if (!postalRaw.trim()) {
    postalStatusText.textContent = "We'll tell you right away whether you're in Tiffany's area.";
    return { ok: false, area: null };
  }

  const area = serviceArea(postalRaw, catalog);

  if (area.reason === 'invalidFormat') {
    postalStatusText.textContent = "That doesn't look like a Canadian postal code (e.g. M4B 1B3).";
    return { ok: false, area };
  }
  if (area.reason === 'incompletePostalCode') {
    postalStatusText.textContent = 'One more character and we can place it.';
    return { ok: false, area };
  }
  if (area.status === 'served') {
    postalStatusText.textContent = `${area.label} — Tiffany's area.`;
  } else if (area.status === 'byRequest') {
    postalStatusText.textContent = 'Just outside Toronto. Tiffany sometimes travels into the GTA for a fee agreed beforehand — send the request and ask.';
  } else {
    postalStatusText.textContent = "That's outside the area Tiffany usually covers. You can still send the request and ask.";
  }
  return { ok: true, area };
}

function updateEstimate () {
  const homeType = homeTypeSelect.value;
  const bedrooms = bedroomsInput.value;
  const bathrooms = bathroomsInput.value;
  const est = estimateSqFt({ homeType, bedrooms, bathrooms }, catalog);
  const rounded = Math.round(est);
  sqftInput.value = String(rounded);
  const beds = Number(bedrooms) || 0;
  const baths = Number(bathrooms) || 0;
  estimateNoteText.textContent = `Estimated at ${rounded} sq ft for a ${HOME_TYPE_LABELS[homeType]} with ${beds} bedroom${beds === 1 ? '' : 's'} and ${baths} bathroom${baths === 1 ? '' : 's'} — adjust the square footage above any time if you know the exact number.`;
  estimateNote.hidden = false;
}

function recompute () {
  const postalRaw = postalInput.value;
  const postal = updatePostalStatus(postalRaw);

  const serviceInput = form.querySelector('input[name="service"]:checked');
  const service = serviceInput ? serviceInput.value : null;
  const sqFt = Number(sqftInput.value) || 0;

  const addOns = readAddOns();
  const conditions = readConditions();

  const missing = [];
  if (!service || !catalog.services[service]) missing.push({ text: 'Choose a service (step 1)', href: '#quote-step-1' });
  if (!postal.ok) missing.push({ text: 'Your postal code (step 2)', href: '#quote-step-2' });
  if (sqFt <= 0) missing.push({ text: 'Approximate square footage (step 3)', href: '#quote-step-3' });
  if (conditions.unanswered > 0) {
    missing.push({
      text: conditions.unanswered === 3
        ? 'The three questions about the home (step 5)'
        : `${conditions.unanswered} more question${conditions.unanswered === 1 ? '' : 's'} about the home (step 5)`,
      href: '#quote-step-5',
    });
  }

  if (missing.length) {
    renderIncomplete(missing);
    setBar('Still needed', `${missing.length} more answer${missing.length === 1 ? '' : 's'}`);
    return;
  }

  renderReady({
    serviceLabel: catalog.services[service].label,
    sqFt,
    addOns,
    postal: postal.area.normalized,
    area: postal.area,
    conditions: conditions.answers,
  });
  setBar('Your request', 'Ready to send');
}

// Deep-linked from the home page's card, which posts both halves of what the
// visitor chose: ?service=deep&size=condo|2|1. Carrying only the service would
// make them describe the same home twice.
function applyQuery () {
  const params = new URLSearchParams(window.location.search);

  const wantedService = params.get('service');
  if (wantedService) {
    const radio = form.querySelector(`input[name="service"][value="${CSS.escape(wantedService)}"]`);
    if (radio) radio.checked = true;
  }

  const size = decodeSize(params.get('size'));
  if (!size || !catalog.sqFtEstimator[size.homeType]) return;

  homeTypeSelect.value = size.homeType;
  bedroomsInput.value = String(size.bedrooms);
  bathroomsInput.value = String(size.bathrooms);

  // Opened, not hidden: the square footage is an ESTIMATE the customer should
  // see the basis for and be able to correct.
  unsureToggle.checked = true;
  estimatorPanel.hidden = false;
  updateEstimate();
}

function wireForm () {
  window.addEventListener('scroll', scheduleBarSync, { passive: true });
  window.addEventListener('resize', scheduleBarSync);
  syncBar();

  form.addEventListener('input', recompute);
  form.addEventListener('change', recompute);

  unsureToggle.addEventListener('change', () => {
    estimatorPanel.hidden = !unsureToggle.checked;
    if (unsureToggle.checked) {
      updateEstimate();
      recompute();
    }
  });

  for (const el of [homeTypeSelect, bedroomsInput, bathroomsInput]) {
    for (const evt of ['input', 'change']) {
      el.addEventListener(evt, () => {
        if (!unsureToggle.checked) return;
        updateEstimate();
        recompute();
      });
    }
  }

  applyQuery();

  // Both counted add-ons behave identically: ticking the box enables the
  // spinner and seeds it with 1 (a ticked box with a 0 count means nothing),
  // unticking resets it to 0.
  for (const [toggle, count] of [[windowsToggle, windowsCount], [appliancesToggle, appliancesCount]]) {
    toggle.addEventListener('change', () => {
      count.disabled = !toggle.checked;
      if (toggle.checked && Number(count.value) <= 0) count.value = '1';
      if (!toggle.checked) count.value = '0';
      recompute();
    });
  }

  recompute();
}

async function init () {
  try {
    // Resolved against THIS module's URL, not the site root — a root-absolute
    // path breaks the moment the site is served from a subpath.
    const res = await fetch(new URL('../../data/catalog.json', import.meta.url));
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
    catalog = await res.json();
  } catch (err) {
    summaryBody.innerHTML = '';
    summaryBody.appendChild(noteEl('The form is temporarily unavailable. Please call or text (416) 564-2125 and Tiffany will quote it with you.'));
    return;
  }
  wireForm();
}

init();
