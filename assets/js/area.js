// PURE MODULE. Same constraints as quote.js — imported by the Phase 2 Worker.

// minimal: zones resolve on a 1–2 character postal prefix, not geocoding.
// Ceiling: 'L4' spans south Vaughan (a short hop) and Newmarket (a day trip),
// so a handful of addresses are mispriced. Upgrade path: swap this lookup for
// a distance matrix keyed on the full FSA if travel fees ever become material.
export function travelZone (postalCode, pricing) {
  const miss = (reason) => ({ zone: null, fee: 0, label: null, normalized: null, reason });

  if (typeof postalCode !== 'string') return miss('invalidFormat');

  const cleaned = postalCode.toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^([A-Z]\d[A-Z])(\d[A-Z]\d)$/);
  if (!match) return miss('invalidFormat');

  const normalized = `${match[1]} ${match[2]}`;

  // Longest prefix wins, so 'L5' beats a bare 'L'.
  let best = null;
  for (const [zone, cfg] of Object.entries(pricing.travelZones)) {
    for (const prefix of cfg.prefixes) {
      if (normalized.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
        best = { zone, cfg, prefix };
      }
    }
  }

  if (!best) return { ...miss('unknownZone'), normalized };

  return {
    zone: best.zone,
    fee: best.cfg.fee,
    label: best.cfg.label,
    normalized,
    reason: null,
  };
}
