/* ============================================================
   modal.js — Shared modal lifecycle utility
   Provides: openModal, closeModal, wireModalEvents
   Used by: views/strategy.js, views/config-stores.js
   ============================================================ */

/* Trigger element whose focus is restored when the active modal closes. */
var _modalTriggerElement = null;

/**
 * Append a modal HTML string to the document body and return the overlay element.
 * Stores triggerEl for focus restoration when the modal closes.
 *
 * @param {string}  html      - Full modal HTML including the outer .cs-modal-overlay wrapper.
 * @param {Element} triggerEl - Element that held focus before the modal was opened.
 * @returns {Element} The appended overlay element (document.body.lastElementChild).
 */
function openModal(html, triggerEl) {
  _modalTriggerElement = triggerEl || null;
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild;
}

/**
 * Remove the overlay from the DOM and restore focus to the stored trigger element.
 *
 * @param {Element} overlay - The overlay element returned by openModal().
 */
function closeModal(overlay) {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  if (_modalTriggerElement && typeof _modalTriggerElement.focus === 'function') {
    _modalTriggerElement.focus();
  }
  _modalTriggerElement = null;
}

/**
 * Wire standard keyboard / pointer lifecycle events onto an open modal overlay.
 *
 * @param {Element} overlay - The overlay element returned by openModal().
 * @param {object}  opts
 * @param {Function} opts.onClose         - Called when the user closes the modal
 *   (Escape key, overlay click, .cs-modal-close button, or [id$="-cancel-btn"] button).
 * @param {Function} [opts.onSubmit]       - Called when Enter is pressed on a
 *   focusable non-BUTTON element inside the modal.
 * @param {boolean}  [opts.excludeTextarea=false] - When true, Enter on TEXTAREA
 *   elements is also excluded from triggering onSubmit.
 */
function wireModalEvents(overlay, opts) {
  var modal = overlay.querySelector('.cs-modal');

  /* Close on overlay backdrop click */
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) opts.onClose();
  });

  /* Escape + Tab focus trap */
  overlay.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      opts.onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    var focusable = modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) { e.preventDefault(); return; }
    var first = focusable[0];
    var last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  });

  /* Enter-to-submit */
  modal.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'BUTTON') return;
    if (opts.excludeTextarea && e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (opts.onSubmit) opts.onSubmit();
  });

  /* Close buttons: the × header button and any footer Cancel button */
  var closeBtns = overlay.querySelectorAll('.cs-modal-close, [id$="-cancel-btn"]');
  for (var i = 0; i < closeBtns.length; i++) {
    closeBtns[i].addEventListener('click', opts.onClose);
  }
}
