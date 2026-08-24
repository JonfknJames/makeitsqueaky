// assets/js/ui.js
// Site chrome behaviour — zero runtime dependencies.
//
// This file used to drive a 3D coverflow carousel for the four services.
// That component is gone: a coverflow earns its complexity when a list is
// too long to show at once, and with four fixed services it hid three
// quarters of the content, could not fit a real description in a 280x360
// card, and leaked readable text fragments from the wrapped card past the
// track's edge mask. Four services that never change are simply shown —
// see .ms-service-grid in assets/css/site.css. Losing the carousel also
// loses its auto-cycle, and with it the WCAG 2.2.2 obligation to ship a
// pause control for motion nobody asked for.
//
// UI-only module — does not import, read, or modify quote.js, area.js,
// estimator.js, or anything in data/ or tests/.
(function () {
  'use strict';

  // Years of experience — counted, not typed.
  //
  // "Twelve years" appeared in eleven places across the site: the hero, the
  // footer tagline on all eight pages, and three spots on the About page.
  // Every one of them was a hand-typed number that silently becomes a lie on
  // 1 January. This reads ONE date from the markup and derives the rest.
  //
  // The HTML still ships a correct number, so this only ever REPLACES a good
  // value with an equally good one — with JavaScript off, or for a crawler
  // that does not run it, the page still reads correctly. It just stops
  // being correct by luck.
  //
  // Year granularity on purpose: Tiffany's start month is not recorded, so
  // the count ticks over on 1 January rather than pretending to know an
  // anniversary. Guarded against a future/garbage attribute — a negative or
  // absurd result leaves the authored number alone rather than rendering
  // "-1 years".
  for (const el of document.querySelectorAll('[data-years-since]')) {
    const startYear = Number(el.getAttribute('data-years-since'));
    if (!Number.isInteger(startYear)) continue;
    const years = new Date().getFullYear() - startYear;
    if (years < 1 || years > 80) continue;
    el.textContent = String(years);
  }

  // Mobile nav disclosure. Desktop (>=64em) shows the list unconditionally
  // via CSS, so this only matters below that breakpoint. Previously this
  // was copy-pasted inline into all eight pages; it lives here now so the
  // header really is one implementation rather than eight that agree.
  const toggle = document.getElementById('ms-nav-toggle');
  const list = document.getElementById('ms-nav-list');
  if (!toggle || !list) return;

  function close () {
    toggle.setAttribute('aria-expanded', 'false');
    list.classList.remove('is-open');
  }

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    list.classList.toggle('is-open', !isOpen);
  });

  list.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') close();
  });

  // Escape closes the menu and returns focus to the control that opened it,
  // so a keyboard user is never left inside a panel they cannot dismiss.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      close();
      toggle.focus();
    }
  });

  // A tap outside an open menu should dismiss it — otherwise the panel
  // covers the page content it is sitting on top of with no way out but
  // the toggle itself.
  document.addEventListener('click', (e) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (toggle.contains(e.target) || list.contains(e.target)) return;
    close();
  });
})();

// --------------------------------------------------------------------------
// Motion — the driver for the Motion section at the end of assets/css/site.css.
//
// Kept in its own IIFE rather than folded into the block above, because that
// one returns early when a page has no nav toggle. Motion is not the nav's
// dependant and must not inherit its exit.
//
// Everything here is additive: the CSS hides nothing until this file adds
// .ms-motion to <html>, so if this block throws, is blocked, or never runs,
// the page is exactly the page it was before.
// --------------------------------------------------------------------------
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) return;

  const root = document.documentElement;
  root.classList.add('ms-motion');

  // rAF-coalesced writer. Pointer and scroll events both fire faster than the
  // compositor can use, and setting a custom property per event is how a
  // 3-line effect turns into a dropped frame.
  function throttled (fn) {
    let queued = false;
    let lastArgs = null;
    return function (...args) {
      lastArgs = args;
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        fn(...lastArgs);
      });
    };
  }

  // ------------------------------------------------------------------------
  // Depth reveal.
  //
  // Selected by class rather than by an authored data attribute, so the eight
  // pages need no markup change and cannot drift out of sync with each other.
  // The exclusions matter: the quote summary re-renders its notes on every
  // keystroke, and a fresh element carrying the hidden state would flicker the
  // customer's own price at them while they type.
  // ------------------------------------------------------------------------
  const REVEAL = [
    '.ms-section__head',
    '.ms-service-tile',
    '.ms-rate-card',
    '.ms-table-wrap',
    '.ms-contact-list__item',
    '.ms-photo-banner',
    '.ms-photo-frame',
    '.ms-photo-slot',
    '.ms-services__note',
    '.ms-prose',
  ].join(',');

  const EXCLUDE = '.ms-quote-summary, .ms-quote-form, .ms-hero';

  // Trigger line: an element reveals once its top edge rises above this.
  const triggerLine = () => window.innerHeight * 0.92;

  // Deliberately NOT IntersectionObserver.
  //
  // The first version of this used one, and it stranded content on iOS. The
  // measured behaviour (WebKit, iPhone 14): after a programmatic scroll to a
  // position where four service tiles sat squarely in the viewport, the
  // observer had reported zero of them intersecting. Chromium revealed all
  // six elements on the same page at the same offsets.
  //
  // Rect maths has no such ambiguity. It is a handful of reads on a scroll
  // frame — the list shrinks as elements reveal and is usually empty within
  // one screen of scrolling — and it answers the only question being asked:
  // is this above the line yet. An effect that hides content has to be
  // provably reversible on every engine, not merely on the one I develop on.
  const pending = [];

  const candidates = [...document.querySelectorAll(REVEAL)]
    .filter((el) => !el.closest(EXCLUDE));

  // MEASURE EVERYTHING FIRST, then mutate. Reading a rect in between setting
  // the hidden attribute and adding the revealed class forces the browser to
  // resolve style while the element is still at opacity 0 — which starts a
  // real 620ms transition on content the visitor is already looking at.
  // Above-the-fold panels faded up from nothing on load, which is exactly the
  // flash the immediate-reveal branch below exists to prevent. Splitting the
  // reads from the writes also stops the loop thrashing layout per element.
  const line = window.innerHeight * 0.92;
  const onScreen = candidates.map((el) => el.getBoundingClientRect().top < line);

  candidates.forEach((el, i) => {
    el.setAttribute('data-ms-reveal', '');

    if (onScreen[i]) {
      // Attribute and class land in the SAME frame with no style resolution
      // between them, so this element is never painted hidden.
      el.classList.add('is-revealed');
      return;
    }

    // Stagger within a row, capped: past about four steps a stagger stops
    // reading as choreography and starts reading as a slow page.
    const peers = el.parentElement ? [...el.parentElement.children] : [el];
    el.style.transitionDelay = Math.min(peers.indexOf(el), 3) * 70 + 'ms';
    pending.push(el);
  });

  function checkReveals () {
    const line = triggerLine();
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      // top < line only — deliberately not "and bottom > 0". An element the
      // visitor jumped clean past (an in-page #anchor, a restored scroll
      // position, a find-in-page) is above the viewport entirely, and
      // requiring it to still be on screen would leave it hidden forever
      // with nothing left to trigger it. Once past the line, it stays shown.
      if (pending[i].getBoundingClientRect().top >= line) continue;
      pending[i].classList.add('is-revealed');
      pending.splice(i, 1);
    }
  }

  const onReveal = throttled(checkReveals);
  window.addEventListener('scroll', onReveal, { passive: true });
  window.addEventListener('resize', onReveal, { passive: true });
  // Images carry width/height so layout is stable, but a late webfont or a
  // slow photo can still shift things; re-check once everything has landed.
  window.addEventListener('load', checkReveals);
  checkReveals();

  // ------------------------------------------------------------------------
  // Pointer tilt on lifted panels.
  // ------------------------------------------------------------------------
  const MAX_TILT_DEG = 4;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  if (finePointer.matches) {
    // Service tiles only — the pricing page's rates are one divided panel now,
    // not four cards, and a single wide surface tilting reads as the page
    // wobbling rather than as a card responding.
    for (const card of document.querySelectorAll('.ms-service-tile')) {
      const apply = throttled((x, y) => {
        card.style.setProperty('--ms-tilt-y', (x * MAX_TILT_DEG).toFixed(2) + 'deg');
        // Negated: pointer below centre should tip the card's FAR edge up, the
        // way a real panel pivots about its middle.
        card.style.setProperty('--ms-tilt-x', (-y * MAX_TILT_DEG).toFixed(2) + 'deg');
      });

      card.addEventListener('pointerenter', () => card.classList.add('is-tilting'));

      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        apply(
          (e.clientX - r.left) / r.width * 2 - 1,
          (e.clientY - r.top) / r.height * 2 - 1,
        );
      });

      card.addEventListener('pointerleave', () => {
        card.classList.remove('is-tilting');
        card.style.setProperty('--ms-tilt-x', '0deg');
        card.style.setProperty('--ms-tilt-y', '0deg');
      });
    }
  }

  // No hero parallax.
  //
  // There was one here: the photo and the quote card tracked the pointer by
  // different amounts to fake depth. It was removed because it was disruptive
  // in use — the card carries the price and two selects the visitor is
  // actively reading and clicking, and moving a control while someone is
  // trying to aim at it makes the page feel unstable rather than deep.
  //
  // The general rule this leaves behind: parallax belongs on things the
  // visitor LOOKS at, never on things they OPERATE.

  // ------------------------------------------------------------------------
  // The duck drifts against the photograph it sits on.
  // ------------------------------------------------------------------------
  const ducks = [...document.querySelectorAll('.ms-duck-badge')];

  if (ducks.length) {
    const DRIFT_PX = 9;

    const onScroll = throttled(() => {
      const mid = window.innerHeight / 2;
      for (const duck of ducks) {
        const r = duck.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        // -1 at the top of the viewport, +1 at the bottom.
        const offset = ((r.top + r.height / 2) - mid) / mid;
        duck.style.setProperty(
          '--ms-drift',
          (Math.max(-1, Math.min(1, offset)) * DRIFT_PX).toFixed(1) + 'px',
        );
      }
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ------------------------------------------------------------------------
  // A visitor who turns reduced motion ON mid-visit gets it honoured now,
  // not on their next page load. Removing the class re-shows anything the
  // observer has not reached; the CSS block guarded by the same preference
  // flattens the transforms.
  // ------------------------------------------------------------------------
  const stop = () => { if (reduceMotion.matches) root.classList.remove('ms-motion'); };
  if (typeof reduceMotion.addEventListener === 'function') {
    reduceMotion.addEventListener('change', stop);
  }
})();
