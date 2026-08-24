// PURE MODULE. No DOM, no fetch, no node:* imports, no Date.now().
// Imported unchanged by the Phase 2 Cloudflare Worker so the server can
// recompute any price the browser claims. Keep it that way.
//
// area.js is imported here on purpose: travel is DERIVED from the postal code
// inside this function, never accepted as a price from the caller. Both
// modules are pure, so the Worker gets the identical verdict the browser
// reached from the identical inputs — which is the whole point of the split.
import { travelZone } from './area.js';

const ADD_ON_TYPES = new Set(['fixed', 'perUnit', 'quoteOnly']);

// Tiffany's rate card prices three add-ons as a FLOOR, not a fixed amount:
// cabinets and wall washing at "$75+", kitchen appliances at "$25+ per
// appliance". Those had been modelled as quoteOnly, which suppressed the
// customer's whole price the moment one was ticked, and published "Quoted on
// request" against a number she had actually given us.
//
// `from: true` is orthogonal to the pricing TYPE on purpose. A floor still
// prices exactly like a fixed or per-unit amount — it is charged, it lands in
// the total — the only difference is what may be claimed about it afterwards:
// the quote becomes an estimate rather than a firm bookable number. Modelling
// it as a fourth type would have duplicated both pricing branches.
//
// The distinction that matters: `from` means "at least this much", while
// quoteOnly means "cannot be priced from a form at all". Heavy grime, heavy
// pet hair and construction residue are the genuine quoteOnly cases and they
// live in conditionFlags, where they belong.

/** Round to whole dollars, half up. */
function dollars (n) {
  return Math.round(n);
}

export function quote (input, pricing) {
  const service = pricing.services[input.service];
  if (!service) throw new Error(`Unknown service: ${input.service}`);

  // Clamped, not trusted: a negative square footage would otherwise bill
  // negative line items and pull the total down.
  const sqFt = Math.max(0, Number(input.sqFt) || 0);

  const reasons = [];
  const flag = (reason) => { if (!reasons.includes(reason)) reasons.push(reason); };

  if (sqFt > pricing.maxSqFt) flag('exceedsMaxSqFt');

  for (const conditionFlag of input.conditionFlags || []) {
    if (pricing.conditionFlags.includes(conditionFlag)) flag(conditionFlag);
  }

  const selected = input.addOns || {};

  // Validate the rate card BEFORE pricing anything. An unrecognised type is a
  // typo in pricing.json — the file that is meant to be edited without a
  // deploy or a review. Falling through to "charge them" would both remove a
  // safety diversion and start billing for it, so this throws instead.
  for (const [key, value] of Object.entries(selected)) {
    const addOn = pricing.addOns[key];
    if (!addOn) throw new Error(`Unknown add-on: ${key}`);
    if (!ADD_ON_TYPES.has(addOn.type)) {
      throw new Error(`Unknown add-on type "${addOn.type}" for add-on: ${key}`);
    }
    // "At least $75" and "cannot be priced from a form" are contradictory
    // claims about the same line. Silently honouring one of them would mean
    // the rate card says something the engine does not do — the exact class
    // of drift this whole validation block exists to refuse.
    if (addOn.from && addOn.type === 'quoteOnly') {
      throw new Error(`Add-on "${key}" is both quoteOnly and from-priced — pick one`);
    }
    if (addOn.from && !(Number(addOn.price) > 0)) {
      throw new Error(`Add-on "${key}" is from-priced but carries no floor price`);
    }
    if (value && addOn.type === 'quoteOnly') flag(key);
  }

  // Travel is DERIVED from the postal code, never supplied by the caller.
  // A malformed or unmapped code is not a $0 fee — it is a job we cannot
  // price automatically, so it routes to the quote path on both sides.
  let travelFee = 0;
  const postalGiven = input.postalCode !== undefined
    && input.postalCode !== null
    && String(input.postalCode).trim() !== '';

  if (postalGiven) {
    const zone = travelZone(String(input.postalCode), pricing);
    if (zone.reason) flag(zone.reason);            // 'invalidFormat' | 'unknownZone'
    else travelFee = Math.max(0, Number(zone.fee) || 0);
  }

  const basePrice = dollars(sqFt * service.ratePerSqFt);

  const lineItems = [{ label: `${service.label} — ${sqFt} sq ft`, amount: basePrice }];

  let addOnTotal = 0;

  // Labels of the from-priced add-ons actually chosen. Only a SELECTED one
  // makes the total a floor — the rate card carrying floors elsewhere is
  // irrelevant to a customer who ticked none of them.
  const fromPriced = [];

  for (const [key, value] of Object.entries(selected)) {
    const addOn = pricing.addOns[key];
    if (addOn.type === 'quoteOnly') continue;   // handled by the condition gate above
    if (!value) continue;

    if (addOn.type === 'perUnit') {
      const raw = Number(value);
      const count = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      if (count <= 0) continue;
      // A house with more interior windows than this warrants a look, not an
      // instant four-figure total off a spinner nobody sanity-checked.
      if (count > pricing.maxAddOnUnits) { flag('exceedsMaxAddOnUnits'); continue; }
      const amount = dollars(addOn.price * count);
      addOnTotal += amount;
      lineItems.push({ label: `${addOn.label} × ${count}`, amount, from: !!addOn.from });
      if (addOn.from) fromPriced.push(addOn.label);
    } else {
      const amount = dollars(addOn.price);
      addOnTotal += amount;
      lineItems.push({ label: addOn.label, amount, from: !!addOn.from });
      if (addOn.from) fromPriced.push(addOn.label);
    }
  }

  const subtotal = basePrice + addOnTotal;
  const minimumApplied = subtotal < pricing.minimumJobPrice;
  const flooredTotal = minimumApplied ? pricing.minimumJobPrice : subtotal;

  if (minimumApplied) {
    lineItems.push({ label: 'Half-day minimum', amount: flooredTotal - subtotal });
  }

  // Travel is added AFTER the floor. Folding it in first would let the minimum
  // swallow the fee and she would travel to the 905 unpaid.
  if (travelFee > 0) {
    lineItems.push({ label: 'Travel', amount: travelFee });
  }

  const total = flooredTotal + travelFee;

  // Budget off the work, not the commute — she is not paid to sit on the GO
  // train.
  //
  // Conditional, because the rate card the BROWSER downloads no longer carries
  // her internal hourly rate floor. It used to: data/pricing.json is fetched
  // by every visitor, so the number was one devtools tab away from any
  // customer who thought to look, and would have been permanently public the
  // moment this repo was. tests/copy-rules.test.js was guarding the rendered
  // copy the whole time and could not see the payload underneath it.
  //
  // (The name of that field is deliberately not written out here. Comments
  // ship to the browser verbatim, which is the same test's other assertion.)
  //
  // Phase 2 keeps the number server-side and passes a rate card that still has
  // it, which is the only place a scheduling figure was ever any use — nothing
  // in the browser has ever read this value. Absent floor, absent budget.
  const hourBudgetHours = Number(pricing.hourlyFloor) > 0
    ? Math.floor((flooredTotal / pricing.hourlyFloor) * 2) / 2
    : null;

  return {
    quoteOnly: reasons.length > 0,
    reasons,
    currency: pricing.currency,
    basePrice,
    addOnTotal,
    subtotal,
    minimumApplied,
    travelFee,
    total,
    // A total containing a floor-priced line is a STARTING price, not the
    // price. Kept separate from quoteOnly so the caller cannot collapse the
    // two: quoteOnly means show no number, isEstimate means show this number
    // and say it can only go up.
    isEstimate: fromPriced.length > 0,
    fromPriced,
    unit: service.unit,
    hourBudgetHours,
    lineItems,
  };
}
