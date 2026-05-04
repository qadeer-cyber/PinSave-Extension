/*
 * manualDescriptionPatch.js
 *
 * Adds a manual "Description" textarea inside the existing destination-link
 * banner. When the user types a description and saves a pin, this patch sets
 * Pinterest's create-pin URL `description` query param to the typed value.
 *
 * Optional: if the field is empty, whatever description bundle.js originally
 * passed is left intact (no override). The destination-link patch's behavior
 * is unchanged - this script chains on top of its window.open wrapper.
 */
(function () {
  'use strict';

  const HOST_WRAP_ID = 'pbe-destination-link-wrap';
  const LINK_INPUT_ID = 'pbe-destination-link';
  const FIELD_ROW_ID = 'pbe-description-row';
  const TEXTAREA_ID = 'pbe-destination-description';
  const COUNTER_ID = 'pbe-destination-description-counter';
  const MAX_LEN = 500;

  function getTextarea() {
    return document.getElementById(TEXTAREA_ID);
  }

  function getDescription(options) {
    const ta = getTextarea();
    const value = ta ? ta.value.trim() : '';
    if (!value) return null;
    const trimmed = value.length > MAX_LEN ? value.slice(0, MAX_LEN) : value;
    if (options && options.consume && ta) {
      ta.value = '';
      updateCounter(ta);
    }
    return trimmed;
  }

  window.__pbe_getManualDescription = getDescription;

  function updateCounter(ta) {
    const counter = document.getElementById(COUNTER_ID);
    if (!counter) return;
    const len = ta.value.length;
    counter.textContent = len + ' / ' + MAX_LEN;
    counter.style.color = len > MAX_LEN ? '#e60023' : '#6b7280';
  }

  function injectField() {
    if (!document.body) return;
    if (document.getElementById(FIELD_ROW_ID)) return;

    const host = document.getElementById(HOST_WRAP_ID);
    if (!host) return;

    const row = document.createElement('div');
    row.id = FIELD_ROW_ID;
    row.style.cssText = 'margin-top:8px;';

    const label = document.createElement('label');
    label.htmlFor = TEXTAREA_ID;
    label.textContent = 'Description (optional)';
    label.style.cssText = 'display:block;font-size:12px;font-weight:700;color:#111;margin-bottom:6px;';

    const ta = document.createElement('textarea');
    ta.id = TEXTAREA_ID;
    ta.rows = 2;
    ta.spellcheck = true;
    ta.placeholder = 'Type a Pinterest description for this pin (optional).';
    ta.maxLength = MAX_LEN + 50;
    ta.style.cssText = [
      'width:100%',
      'min-height:48px',
      'border:1px solid #ddd',
      'border-radius:8px',
      'padding:8px 10px',
      'font-size:12px',
      'box-sizing:border-box',
      'outline:none',
      'resize:vertical',
      'font-family:inherit',
      'line-height:1.4'
    ].join(';');

    const counter = document.createElement('div');
    counter.id = COUNTER_ID;
    counter.style.cssText = 'margin-top:4px;font-size:10px;color:#6b7280;text-align:right;font-weight:600;';

    ta.addEventListener('input', function () { updateCounter(ta); });

    row.appendChild(label);
    row.appendChild(ta);
    row.appendChild(counter);
    host.appendChild(row);

    updateCounter(ta);

    // Existing patch sets this var to 92px - bump it so the popup body has
    // room for both the destination link AND the description textarea.
    document.documentElement.style.setProperty('--pbe-manual-link-offset', '180px');
  }

  function destinationFieldHasValue() {
    const di = document.getElementById(LINK_INPUT_ID);
    return !!(di && di.value.trim());
  }

  /*
   * Chain on top of whatever window.open is already wrapped to. Order:
   *   bundle.js calls window.open()
   *     -> THIS wrapper sets `description` (if user typed one)
   *     -> previous wrapper (manualLinkPatch) sets `url`, may throw if empty
   *     -> real window.open
   * We only consume the description AFTER confirming the destination link is
   * present, so an empty-link error doesn't eat the user's typed description.
   */
  const previousOpen = window.open;
  window.open = function (url, name, features) {
    if (typeof url === 'string' && url.indexOf('pinterest.com/pin/create/extension/') !== -1) {
      if (destinationFieldHasValue()) {
        const desc = getDescription({ consume: true });
        if (desc) {
          try {
            const parsed = new URL(url);
            parsed.searchParams.set('description', desc);
            url = parsed.toString();
          } catch (e) { /* fall through with original url */ }
        }
      }
    }
    return previousOpen.call(window, url, name, features);
  };

  injectField();
  new MutationObserver(injectField).observe(document.documentElement, { childList: true, subtree: true });
})();
