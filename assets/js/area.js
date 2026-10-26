// PURE MODULE. No DOM, no fetch, no node:* imports. Shared by the browser and,
// in the server phase, by whatever receives the request.
//
// Where a postal code falls, in the business's own terms:
//
//   served     City of Toronto (M). Tiffany's area.
//   byRequest  The GTA (L). Not promised — Tiffany sometimes travels for a fee
//              agreed beforehand, so the request goes through and she decides.
//   outside    A valid Canadian code anywhere else. The request still goes
//              through; the status line says plainly it is outside her area.
//
// The zone is fixed by the first character or two, so a partial code resolves
// as soon as it can and never changes as more of the same code arrives.
// `complete` says whether all six characters were given, for the request
// Tiffany receives, without gating anything on it.
//
// No money lives here. Fees, if any, are Tiffany's to name in the
// conversation the request opens; the public catalog carries none.
export function serviceArea (postalCode, catalog) {
  const miss = (reason) => ({ status: null, zone: null, label: null, normalized: null, complete: false, reason });

  if (typeof postalCode !== 'string') return miss('invalidFormat');

  const cleaned = postalCode.toUpperCase().replace(/\s+/g, '');
  // Any non-empty prefix of A1A 1A1: letter, digit, letter, digit, letter,
  // digit, in that order, and nothing past the sixth.
  if (!/^[A-Z](\d([A-Z](\d([A-Z]\d?)?)?)?)?$/.test(cleaned)) return miss('invalidFormat');

  const normalized = cleaned.length > 3 ? `${cleaned.slice(0, 3)} ${cleaned.slice(3)}` : cleaned;
  const complete = cleaned.length === 6;

  // Longest prefix wins. A zone prefix the input has not reached yet is not a
  // miss — it is the next keystroke's decision.
  let best = null;
  let undecided = false;
  for (const [zone, cfg] of Object.entries(catalog.serviceArea)) {
    for (const prefix of cfg.prefixes) {
      if (cleaned.startsWith(prefix)) {
        if (!best || prefix.length > best.prefix.length) best = { zone, cfg, prefix };
      } else if (prefix.startsWith(cleaned)) {
        undecided = true;
      }
    }
  }

  if (!best) {
    if (undecided) return { ...miss('incompletePostalCode'), normalized, complete };
    return { status: 'outside', zone: null, label: null, normalized, complete, reason: null };
  }

  return {
    status: best.cfg.status,
    zone: best.zone,
    label: best.cfg.label,
    normalized,
    complete,
    reason: null,
  };
}
