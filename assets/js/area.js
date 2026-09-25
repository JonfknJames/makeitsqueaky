// PURE MODULE. Same constraints as quote.js — imported by the Phase 2 Worker.

// minimal: zones resolve on a 1–2 character postal prefix, not geocoding.
// Ceiling: 'L4' spans south Vaughan (a short hop) and Newmarket (a day trip),
// so a handful of addresses are mispriced. Upgrade path: swap this lookup for
// a distance matrix keyed on the full FSA if travel fees ever become material.
//
// A PARTIAL postal code resolves too. The zone is fixed by the first one or
// two characters, and the other four only ever confirm the format — so
// insisting on all six before pricing held the number back for five
// keystrokes to learn nothing. The price now appears on the first character
// for a Toronto customer and the second in the 905, and it never moves once
// shown: a zone cannot change by typing MORE of the same code. `complete`
// says whether the whole code was given, for the caller that wants it (the
// lead Tiffany receives), without gating the price on it.
export function travelZone (postalCode, pricing) {
  const miss = (reason) => ({ zone: null, fee: 0, label: null, normalized: null, complete: false, reason });

  if (typeof postalCode !== 'string') return miss('invalidFormat');

  const cleaned = postalCode.toUpperCase().replace(/\s+/g, '');
  // Any non-empty prefix of A1A 1A1: letter, digit, letter, digit, letter,
  // digit, in that order, and nothing past the sixth.
  if (!/^[A-Z](\d([A-Z](\d([A-Z]\d?)?)?)?)?$/.test(cleaned)) return miss('invalidFormat');

  const normalized = cleaned.length > 3 ? `${cleaned.slice(0, 3)} ${cleaned.slice(3)}` : cleaned;
  const complete = cleaned.length === 6;

  // Longest prefix wins, so 'L5' beats a bare 'L'. A zone prefix that the
  // input has not reached yet ('L' against 'L5') is not a miss — it is the
  // next keystroke's decision, and must not be reported as out of area.
  let best = null;
  let undecided = false;
  for (const [zone, cfg] of Object.entries(pricing.travelZones)) {
    for (const prefix of cfg.prefixes) {
      if (cleaned.startsWith(prefix)) {
        if (!best || prefix.length > best.prefix.length) best = { zone, cfg, prefix };
      } else if (prefix.startsWith(cleaned)) {
        undecided = true;
      }
    }
  }

  if (!best) return { ...miss(undecided ? 'incompletePostalCode' : 'unknownZone'), normalized, complete };

  return {
    zone: best.zone,
    fee: best.cfg.fee,
    label: best.cfg.label,
    normalized,
    complete,
    reason: null,
  };
}
