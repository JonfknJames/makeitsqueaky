// assets/js/boot.js — the one script that runs BEFORE first paint.
//
// It does one thing: adds `ms-enter` to <html> so the arrival keyframes at the
// end of assets/css/site.css can start from "not yet here". Every other script
// on the site is a deferred module, which runs after the page has already
// painted — fine for a scroll reveal, wrong for an entrance: the visitor would
// see the hero, watch it vanish, then watch it come back. A classic script in
// <head> runs before the body exists, so the first frame the visitor sees is
// already the first frame of the animation.
//
// Fail-safe in both directions. If this file never loads, is blocked, or
// throws, the class is absent, nothing in the stylesheet matches, and the
// page renders exactly as it did before the entrance existed. A visitor who
// prefers reduced motion gets the same: no class, no animation, nothing to
// wait for. (The CSS carries its own reduced-motion guard as well, for a
// preference flipped after this ran.)
//
// Small on purpose — it blocks parsing for exactly as long as it takes to
// read. Keep it dependency-free, keep it classic (no `type="module"`: a
// module is deferred by definition, which defeats the point), and keep it
// doing one thing.
(function () {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('ms-enter');
  } catch (e) {
    // Nothing to do: an engine without matchMedia gets a page without the
    // entrance, which is the page it had before.
  }
})();
