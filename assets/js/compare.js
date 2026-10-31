// assets/js/compare.js — the before/after sliders on the home page.
//
// Each .ms-compare__frame holds the after photo, the before photo clipped to
// --ms-pos from the left, and a transparent <input type="range"> laid over
// the whole frame. The native range gives mouse drag, touch drag, click-to-
// jump and arrow keys for free, and is the one focusable thing in the
// figure; this script copies its value into the custom property the CSS
// clips by, speaks it as a proportion, and marks the ends so the corner tag
// that would sit over the wrong photo can fade. Without JavaScript the frame
// sits at 50/50 and does not move, which is still an honest comparison.
//
// CSP: style-src 'self' blocks inline style attributes, but CSSOM writes
// (el.style.setProperty) are allowed, so --ms-pos is set that way.
for (const frame of document.querySelectorAll('.ms-compare__frame')) {
  const range = frame.querySelector('.ms-compare__range');
  if (!range) continue;
  const apply = () => {
    const v = Number(range.value);
    frame.style.setProperty('--ms-pos', v + '%');
    range.setAttribute('aria-valuetext', v + '% before, ' + (100 - v) + '% after');
    frame.classList.toggle('is-at-start', v < 12);
    frame.classList.toggle('is-at-end', v > 88);
  };
  range.addEventListener('input', apply);
  apply();
  frame.setAttribute('data-ms-compare', 'ready');
}
