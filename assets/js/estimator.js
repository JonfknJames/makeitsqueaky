// PURE MODULE. No DOM, no fetch, no node:* imports, no Date.now().
// Imported unchanged by the Phase 2 Cloudflare Worker so the server can
// recompute any estimate the browser claims. Keep it that way.

/**
 * Rough square footage from room counts, for customers who do not know theirs.
 * Always presented to the customer as an estimate they can override — never
 * silently substituted for a real number.
 */
export function estimateSqFt ({ homeType, bedrooms, bathrooms }, pricing) {
  const model = pricing.sqFtEstimator[homeType];
  if (!model) throw new Error(`Unknown home type: ${homeType}`);

  const beds = Math.max(0, Number(bedrooms) || 0);
  const baths = Math.max(0, Number(bathrooms) || 0);

  return model.base + (beds * model.perBedroom) + (baths * model.perBathroom);
}

/**
 * Decode the home-size token the home page's price preview carries in its
 * select and hands to the calculator as `?size=condo|2|1`.
 *
 * The token is the estimator's OWN inputs rather than a square footage,
 * so the shortlist on the home page cannot drift away from
 * pricing.json's sqFtEstimator — there is no second copy of the numbers to
 * keep in step. It lives here, beside the function it feeds, so both the home
 * page and the quote page read it the same way.
 *
 * Returns null for anything unrecognised. Never a default: silently
 * substituting one home for another prices the wrong house, and a customer
 * arriving from a mangled link should be asked rather than guessed at.
 */
export function decodeSize (token) {
  const match = /^([a-zA-Z]+)\|(\d{1,2})\|(\d{1,2})$/.exec(String(token ?? '').trim());
  if (!match) return null;
  return {
    homeType: match[1],
    bedrooms: Number(match[2]),
    bathrooms: Number(match[3]),
  };
}
