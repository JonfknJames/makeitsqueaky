// assets/js/quote-form.js — DOM wiring only. All pricing logic lives in the
// pure modules (quote.js, area.js, estimator.js). This file never does
// arithmetic on a price — it reads the form, calls the engine, and renders
// whatever the engine returns.
import { quote } from './quote.js';
import { travelZone } from './area.js';
import { estimateSqFt, decodeSize } from './estimator.js';

const SERVICE_LABELS = {
  regular: 'Regular Cleaning',
  deep: 'Deep Cleaning',
  moveInOut: 'Move-In / Move-Out Cleaning',
  postReno: 'Post-Renovation Cleaning',
};

const HOME_TYPE_LABELS = {
  condo: 'condo/apartment',
  townhouse: 'townhouse',
  house: 'house',
};

// Plain-language, non-judgemental explanations for every reason the engine
// can hand back. Never surfaces the internal reason key or her internal rate
// floor to the customer — see tests/copy-rules.test.js.
const REASON_COPY = {
  exceedsMaxSqFt: 'This home is larger than we can price automatically — Tiffany will confirm the details with you directly.',
  exceedsMaxAddOnUnits: 'That is more add-on work than we can price automatically — Tiffany will confirm the details with you directly.',
  heavyGrime: 'Homes that need a deeper reset get a quick look first, so the price is right the first time.',
  heavyPetHair: 'A heavier pet-hair job gets a quick look first, so the price is right the first time.',
  heavyConstructionResidue: 'Construction residue varies a lot from job to job — Tiffany will confirm pricing after a look.',
  // cabinets / wallWashing / appliances deliberately absent. They carry floor
  // prices on the rate card ($75+, $75+, $25+ each), so they no longer
  // suppress the price — they make it a "from" figure instead. See
  // quote.js's `from` flag and renderPriced() below.
  unknownZone: "This postal code isn't in our mapped service area yet — Tiffany will confirm travel and pricing with you personally.",
  invalidFormat: "We couldn't read that postal code — Tiffany will confirm travel and pricing with you personally.",
};

const money = (n) => `$${Math.round(n).toLocaleString('en-CA')}`;

// "a, b" reads as a broken sentence in prose — the list here is spoken aloud
// by a screen reader and read as a sentence by everyone else, so it needs the
// conjunction. No Oxford comma at two items; one at three or more.
function listSentence (items) {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Elements (all present in quote.html — see markup for ids).
const form = document.getElementById('quote-form');
const summaryBody = document.getElementById('quote-summary-body');

const postalInput = document.getElementById('quote-postal');
const postalStatus = document.getElementById('postal-status');
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

// The summary re-renders on every keystroke, so the summary panel itself is
// NOT a live region — announcing the whole price table per character is
// unusable with a screen reader. One short debounced sentence goes here
// instead, once the typing settles.
const liveRegion = document.getElementById('quote-live');
const ANNOUNCE_DELAY_MS = 700;
let announceTimer = null;

function announce (text) {
  if (!liveRegion) return;
  if (announceTimer !== null) window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => { liveRegion.textContent = text; }, ANNOUNCE_DELAY_MS);
}

if (form) form.addEventListener('submit', (e) => e.preventDefault());

function readAddOns () {
  return {
    oven: document.getElementById('addon-oven').checked,
    fridge: document.getElementById('addon-fridge').checked,
    interiorWindows: windowsToggle.checked ? (Number(windowsCount.value) || 0) : 0,
    cabinets: document.getElementById('addon-cabinets').checked,
    wallWashing: document.getElementById('addon-wallwashing').checked,
    // Priced per appliance ($25+ each), so this is a count like windows, not
    // a boolean. Sending `true` here would multiply the floor by 1 and quietly
    // under-bill a four-appliance kitchen.
    appliances: appliancesToggle.checked ? (Number(appliancesCount.value) || 0) : 0,
  };
}

// Which radio answer means "this flag is true", per condition question. Most
// questions are asked so "yes" means the flag applies (more pet hair than
// usual, recent construction) — but the grime question is phrased the other
// way round ("has it been cleaned recently?"), so "no" is the one that
// triggers heavyGrime. Getting this backwards silently prices dirty homes
// as if they were clean, which is exactly what the condition gate exists
// to prevent.
const CONDITION_TRIGGER_VALUE = {
  heavyGrime: 'no',
  heavyPetHair: 'yes',
  heavyConstructionResidue: 'yes',
};

// An UNANSWERED condition question is not a "no". Until all three are
// answered we cannot tell a clean home from one that costs her a twelve-hour
// day, so nothing bookable renders — see renderIncomplete().
function readConditions () {
  const flags = [];
  let unanswered = 0;
  for (const flag of ['heavyGrime', 'heavyPetHair', 'heavyConstructionResidue']) {
    const checked = form.querySelector(`input[name="condition-${flag}"]:checked`);
    if (!checked) { unanswered += 1; continue; }
    if (checked.value === CONDITION_TRIGGER_VALUE[flag]) flags.push(flag);
  }
  return { flags, unanswered };
}

function summarizeAddOns (addOns) {
  const parts = [];
  if (addOns.oven) parts.push('inside oven');
  if (addOns.fridge) parts.push('inside fridge');
  if (addOns.interiorWindows > 0) parts.push(`${addOns.interiorWindows} interior window${addOns.interiorWindows === 1 ? '' : 's'}`);
  // "(from $75)" rather than "(quote needed)" — the message Tiffany receives
  // should say the same thing the customer was shown, or she opens a chat
  // where the two of them believe different numbers were agreed.
  if (addOns.cabinets) parts.push('inside cabinets and drawers (from $75)');
  if (addOns.wallWashing) parts.push('wall washing (from $75)');
  if (addOns.appliances > 0) parts.push(`${addOns.appliances} kitchen appliance${addOns.appliances === 1 ? '' : 's'} (from $25 each)`);
  return parts.length ? parts.join(', ') : 'none';
}

function buildWhatsAppLink ({ service, sqFt, addOns, postalRaw, result, isQuoteOnly }) {
  const lines = [
    `Hi Tiffany! I'd like ${isQuoteOnly ? 'a quote for' : 'to book'}:`,
    `- Service: ${SERVICE_LABELS[service] || service}`,
    `- Approx. size: ${sqFt} sq ft`,
    `- Add-ons: ${summarizeAddOns(addOns)}`,
  ];
  if (postalRaw) lines.push(`- Postal code: ${postalRaw}`);
  if (!isQuoteOnly && result) {
    lines.push(result.isEstimate
      ? `- Starting total: from ${money(result.total)} CAD (${result.unit} booking) — includes add-ons priced from a minimum`
      : `- Estimated total: ${money(result.total)} CAD (${result.unit} booking)`);
  }
  const text = lines.join('\n');
  // minimal: Phase 1 has no backend and no mail account, so the lead goes to
  // WhatsApp where Tiffany already runs her business. Phase 2 replaces this
  // with a real booking POST. Upgrade path: swap this call for fetch('/api/book').
  return `https://wa.me/14165642125?text=${encodeURIComponent(text)}`;
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

function ctaRow ({ whatsAppHref, whatsAppLabel }) {
  const wrap = document.createElement('div');
  wrap.className = 'ms-quote-cta';

  const wa = document.createElement('a');
  wa.className = 'ms-btn ms-btn--accent';
  wa.href = whatsAppHref;
  wa.target = '_blank';
  wa.rel = 'noopener noreferrer';
  wa.textContent = whatsAppLabel;
  wrap.appendChild(wa);

  // Fallback for desktop visitors without WhatsApp. There IS an email address
  // now (it is on the contact page and in the footer), and this is still a
  // phone link on purpose: someone who has just been shown a price is trying
  // to book a date, and a text reaches Tiffany between jobs where an inbox
  // does not. Email is for the enquiry that can wait; this button is not.
  const tel = document.createElement('a');
  tel.className = 'ms-btn ms-btn--ghost';
  tel.href = 'tel:+14165642125';
  tel.textContent = 'Or call/text (416) 564-2125';
  wrap.appendChild(tel);

  return wrap;
}

// The form is deliberately `novalidate` — the price is meant to appear as you
// type, not on submit. That makes THIS the only thing standing between a
// half-filled form and a firm, bookable total, so every missing answer is
// named plainly rather than the price simply not showing up.
function renderIncomplete (missing) {
  summaryBody.innerHTML = '';

  const heading = document.createElement('p');
  heading.className = 'ms-quote-outcome__heading';
  heading.textContent = 'A few more answers and your price appears.';
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
    li.textContent = item;
    ul.appendChild(li);
  }
  textWrap.appendChild(ul);
  note.appendChild(textWrap);
  summaryBody.appendChild(note);

  announce(`Your price isn't ready yet. Still needed: ${missing.join('; ')}.`);
}

function renderPriced (result, ctx) {
  summaryBody.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'ms-table-wrap';
  const table = document.createElement('table');
  table.className = 'ms-table';
  table.innerHTML = '<thead><tr><th scope="col">Item</th><th scope="col">Amount</th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (const item of result.lineItems) {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = item.label;
    const tdAmt = document.createElement('td');
    // A floor reads "From $75" on its own row, so the line the customer can
    // point at carries the caveat — not just a footnote under the total.
    tdAmt.textContent = item.from ? `From ${money(item.amount)}` : money(item.amount);
    tr.append(tdLabel, tdAmt);
    tbody.appendChild(tr);
  }

  const totalRow = document.createElement('tr');
  totalRow.className = 'ms-quote-total-row';
  const totalLabel = document.createElement('td');
  totalLabel.textContent = result.isEstimate ? 'Starting total' : 'Total';
  const totalAmt = document.createElement('td');
  totalAmt.textContent = result.isEstimate
    ? `From ${money(result.total)} ${result.currency}`
    : `${money(result.total)} ${result.currency}`;
  // No accessible handle distinguishes "the running total" from any other
  // table cell — a minimal test hook for the e2e suite (tests/e2e).
  totalAmt.dataset.testid = 'quote-total';
  totalRow.append(totalLabel, totalAmt);
  tbody.appendChild(totalRow);

  table.appendChild(tbody);
  wrap.appendChild(table);
  summaryBody.appendChild(wrap);

  summaryBody.appendChild(noteEl(`This is a ${result.unit} booking.`));

  // Named, not vague. "Some items are estimates" leaves the customer to guess
  // which ones, and a surprise on the invoice is how a good job turns into an
  // argument.
  if (result.isEstimate) {
    const which = listSentence(result.fromPriced).toLowerCase();
    const note = noteEl(`${which} ${result.fromPriced.length === 1 ? 'is' : 'are'} priced from a minimum — the amount above is a starting price, and Tiffany will confirm the final figure after a look. Nothing is charged until you both agree.`);
    note.dataset.testid = 'quote-from-notice';
    summaryBody.appendChild(note);
  }

  summaryBody.appendChild(ctaRow({
    whatsAppHref: buildWhatsAppLink({ ...ctx, result, isQuoteOnly: false }),
    whatsAppLabel: result.isEstimate ? 'Confirm via WhatsApp' : 'Book via WhatsApp',
  }));

  announce(result.isEstimate
    ? `Your starting price: from ${money(result.total)} ${result.currency}, a ${result.unit} booking. Some items are priced from a minimum.`
    : `Your estimate: ${money(result.total)} ${result.currency}, a ${result.unit} booking.`);
}

function renderQuoteOnly (reasons, ctx) {
  summaryBody.innerHTML = '';

  const heading = document.createElement('p');
  heading.className = 'ms-quote-outcome__heading';
  heading.textContent = 'We need a quick look before we can price this.';
  // Minimal test hook for the e2e suite (tests/e2e) — this notice is what
  // guards against ever surfacing a bookable price on a quote-only job.
  heading.dataset.testid = 'quote-only-notice';
  summaryBody.appendChild(heading);

  const note = noteEl('');
  note.querySelector('p').remove();
  const textWrap = document.createElement('div');
  const introP = document.createElement('p');
  introP.innerHTML = '<strong>Why:</strong>';
  textWrap.appendChild(introP);
  const ul = document.createElement('ul');
  ul.className = 'ms-quote-outcome__reasons';
  for (const reason of reasons) {
    const li = document.createElement('li');
    li.textContent = REASON_COPY[reason] || 'This part of the job needs a quick look before it can be priced.';
    ul.appendChild(li);
  }
  textWrap.appendChild(ul);
  note.appendChild(textWrap);
  summaryBody.appendChild(note);

  summaryBody.appendChild(ctaRow({
    whatsAppHref: buildWhatsAppLink({ ...ctx, result: null, isQuoteOnly: true }),
    whatsAppLabel: 'Request your exact quote',
  }));

  announce('We need a quick look before we can price this. Request your exact quote below.');
}

let pricing = null;

// Status line only. The travel FEE is derived inside quote() from the same
// postal code — this function never hands a price to the engine, because the
// Phase 2 server must not trust one from the client either.
function updatePostalStatus (postalRaw) {
  if (!postalRaw.trim()) {
    postalStatusText.textContent = "We'll let you know right away if a travel fee applies.";
    return { complete: false };
  }

  const zone = travelZone(postalRaw, pricing);

  if (zone.reason === 'invalidFormat') {
    postalStatusText.textContent = "That doesn't look like a complete postal code yet (e.g. M4B 1B3).";
    return { complete: false };
  }

  if (zone.reason === 'unknownZone') {
    postalStatusText.textContent = `We don't have ${zone.normalized} mapped yet — Tiffany will confirm travel and pricing with you directly.`;
    return { complete: true };
  }

  postalStatusText.textContent = zone.fee > 0
    ? `${zone.label} — ${money(zone.fee)} travel.`
    : `${zone.label} — no travel fee.`;
  return { complete: true };
}

function updateEstimate () {
  const homeType = homeTypeSelect.value;
  const bedrooms = bedroomsInput.value;
  const bathrooms = bathroomsInput.value;
  const est = estimateSqFt({ homeType, bedrooms, bathrooms }, pricing);
  const rounded = Math.round(est);
  sqftInput.value = String(rounded);
  estimateNoteText.textContent = `Estimated at ${rounded} sq ft for a ${HOME_TYPE_LABELS[homeType]} with ${bedrooms || 0} bedroom(s) and ${bathrooms || 0} bathroom(s) — adjust the square footage above any time if you know the exact number.`;
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
  if (!service) missing.push('Choose a service (step 1)');
  if (!postal.complete) missing.push('Your full postal code (step 2)');
  if (sqFt <= 0) missing.push('Approximate square footage (step 3)');
  if (conditions.unanswered > 0) {
    missing.push(conditions.unanswered === 3
      ? 'The three questions about the home (step 5)'
      : `${conditions.unanswered} more question${conditions.unanswered === 1 ? '' : 's'} about the home (step 5)`);
  }

  if (missing.length) {
    renderIncomplete(missing);
    return;
  }

  const result = quote(
    { service, sqFt, addOns, conditionFlags: conditions.flags, postalCode: postalRaw },
    pricing,
  );

  const ctx = { service, sqFt, addOns, postalRaw };

  if (result.quoteOnly) {
    renderQuoteOnly(result.reasons, ctx);
  } else {
    renderPriced(result, ctx);
  }
}

// Deep-linked from the home page's price preview, which posts both halves of
// what it priced: ?service=deep&size=condo|2|1. Carrying only the service
// would make the customer describe the same home twice and would silently
// discard the number they were just shown — the two pages would be pricing
// different houses within one click of each other.
function applyQuery () {
  const params = new URLSearchParams(window.location.search);

  const wantedService = params.get('service');
  if (wantedService) {
    const radio = form.querySelector(`input[name="service"][value="${CSS.escape(wantedService)}"]`);
    if (radio) radio.checked = true;
  }

  const size = decodeSize(params.get('size'));
  // Unrecognised home type: leave the form alone rather than half-fill it.
  // decodeSize already refuses malformed tokens; this refuses well-formed ones
  // naming a home type the rate card has since dropped.
  if (!size || !pricing.sqFtEstimator[size.homeType]) return;

  homeTypeSelect.value = size.homeType;
  bedroomsInput.value = String(size.bedrooms);
  bathroomsInput.value = String(size.bathrooms);

  // Opened, not hidden. The square footage is an ESTIMATE the customer should
  // see the basis for and be able to correct — arriving with a number in the
  // box and no explanation of where it came from is how a wrong figure goes
  // unchallenged all the way to a booking.
  unsureToggle.checked = true;
  estimatorPanel.hidden = false;
  updateEstimate();
}

function wireForm () {
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
    el.addEventListener('input', () => {
      if (!unsureToggle.checked) return;
      updateEstimate();
      recompute();
    });
    el.addEventListener('change', () => {
      if (!unsureToggle.checked) return;
      updateEstimate();
      recompute();
    });
  }

  applyQuery();

  // Both counted add-ons behave identically: ticking the box enables the
  // spinner and seeds it with 1 (a ticked box with a 0 count prices as
  // nothing, which looks broken), unticking resets it to 0.
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
    const res = await fetch(new URL('../../data/pricing.json', import.meta.url));
    if (!res.ok) throw new Error(`pricing fetch failed: ${res.status}`);
    pricing = await res.json();
  } catch (err) {
    summaryBody.innerHTML = '';
    summaryBody.appendChild(noteEl('Pricing is temporarily unavailable. Please call or text (416) 564-2125 for a price.'));
    return;
  }
  wireForm();
}

init();
