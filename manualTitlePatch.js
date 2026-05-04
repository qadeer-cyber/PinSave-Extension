/*
 * manualTitlePatch.js
 *
 * Adds a manual "Title (optional)" input inside the existing manualLinkPatch
 * banner. Pinterest's create-pin URL has no documented `title` query param,
 * so on save we hand the typed title off via chrome.storage.local.
 * dashboardLogger.js (running as a content script on the create-pin page)
 * picks it up, fills Pinterest's title field via DOM, logs it, and clears
 * the stored value.
 *
 * Optional: empty title leaves Pinterest's auto-extracted title alone.
 */
(function () {
  'use strict';

  const HOST_WRAP_ID = 'pbe-destination-link-wrap';
  const LINK_INPUT_ID = 'pbe-destination-link';
  const FIELD_ROW_ID = 'pbe-title-row';
  const INPUT_ID = 'pbe-destination-title';
  const COUNTER_ID = 'pbe-destination-title-counter';
  const STORAGE_KEY = 'pbe_pending_title';
  const MAX_LEN = 100;

  function getInput() {
    return document.getElementById(INPUT_ID);
  }

  function getTitle(options) {
    const input = getInput();
    const value = input ? input.value.trim() : '';
    if (!value) return null;
    const trimmed = value.length > MAX_LEN ? value.slice(0, MAX_LEN) : value;
    if (options && options.consume && input) {
      input.value = '';
      updateCounter(input);
    }
    return trimmed;
  }

  window.__pbe_getManualTitle = getTitle;

  function updateCounter(input) {
    const counter = document.getElementById(COUNTER_ID);
    if (!counter) return;
    const len = input.value.length;
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
    label.htmlFor = INPUT_ID;
    label.textContent = 'Title (optional)';
    label.style.cssText = 'display:block;font-size:12px;font-weight:700;color:#111;margin-bottom:6px;';

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = true;
    input.maxLength = MAX_LEN + 20;
    input.placeholder = 'Type a Pinterest title for this pin (optional).';
    input.style.cssText = [
      'width:100%',
      'height:34px',
      'border:1px solid #ddd',
      'border-radius:8px',
      'padding:0 10px',
      'font-size:12px',
      'box-sizing:border-box',
      'outline:none',
      'font-family:inherit'
    ].join(';');

    const counter = document.createElement('div');
    counter.id = COUNTER_ID;
    counter.style.cssText = 'margin-top:4px;font-size:10px;color:#6b7280;text-align:right;font-weight:600;';

    input.addEventListener('input', function () { updateCounter(input); });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(counter);
    host.appendChild(row);

    updateCounter(input);

    // The destination-link patch sets this to 92px; description bumps to 180.
    // Now we have title + description + link, so push down further.
    document.documentElement.style.setProperty('--pbe-manual-link-offset', '244px');
  }

  function destinationFieldHasValue() {
    const di = document.getElementById(LINK_INPUT_ID);
    return !!(di && di.value.trim());
  }

  function stashTitleForCreatePage(title) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      const payload = {};
      payload[STORAGE_KEY] = { title: title, timestamp: Date.now() };
      chrome.storage.local.set(payload);
    } catch (e) { /* ignore */ }
  }

  /*
   * Chain on top of whatever window.open is already wrapped to. We only
   * stash the title when the destination link is set, so an empty-link error
   * (thrown by manualLinkPatch's wrapper) doesn't strand the stored title.
   */
  const previousOpen = window.open;
  window.open = function (url, name, features) {
    if (typeof url === 'string' && url.indexOf('pinterest.com/pin/create/extension/') !== -1) {
      if (destinationFieldHasValue()) {
        const title = getTitle({ consume: true });
        if (title) stashTitleForCreatePage(title);
      }
    }
    return previousOpen.call(window, url, name, features);
  };

  injectField();
  new MutationObserver(injectField).observe(document.documentElement, { childList: true, subtree: true });
})();
