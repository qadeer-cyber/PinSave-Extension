(function () {
  'use strict';

  const INPUT_ID = 'pbe-destination-link';
  const ERROR_ID = 'pbe-destination-link-error';
  const ERROR_TEXT = 'Please enter a destination link before creating the pin.';

  function getInput() {
    return document.getElementById(INPUT_ID);
  }

  function setError(message) {
    const err = document.getElementById(ERROR_ID);
    if (err) err.textContent = message || '';
  }

  function getManualDestinationLink(options) {
    const input = getInput();
    const value = input ? input.value.trim() : '';

    if (!value) {
      setError(ERROR_TEXT);
      if (input) input.focus();
      alert(ERROR_TEXT);
      throw new Error(ERROR_TEXT);
    }

    setError('');

    if (options && options.consume && input) {
      input.value = '';
    }

    return value;
  }

  window.__pbe_getManualDestinationLink = getManualDestinationLink;

  function injectManualLinkField() {
    if (!document.body || getInput()) return;

    const wrap = document.createElement('div');
    wrap.id = 'pbe-destination-link-wrap';
    wrap.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'left:8px',
      'z-index:2147483647',
      'background:#fff',
      'border:1px solid rgba(0,0,0,.12)',
      'border-radius:12px',
      'box-shadow:0 2px 10px rgba(0,0,0,.12)',
      'padding:10px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'box-sizing:border-box'
    ].join(';');

    const label = document.createElement('label');
    label.htmlFor = INPUT_ID;
    label.textContent = 'Destination Link';
    label.style.cssText = 'display:block;font-size:12px;font-weight:700;color:#111;margin-bottom:6px;';

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'url';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Paste your Amazon affiliate link here';
    input.style.cssText = [
      'width:100%',
      'height:34px',
      'border:1px solid #ddd',
      'border-radius:8px',
      'padding:0 10px',
      'font-size:12px',
      'box-sizing:border-box',
      'outline:none'
    ].join(';');

    const error = document.createElement('div');
    error.id = ERROR_ID;
    error.style.cssText = 'min-height:16px;margin-top:5px;font-size:11px;font-weight:600;color:#e60023;';

    input.addEventListener('input', function () {
      if (input.value.trim()) setError('');
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(error);
    document.body.appendChild(wrap);

    // Give the pinned extension card room without changing its internal UI.
    document.documentElement.style.setProperty('--pbe-manual-link-offset', '92px');
  }

  const originalOpen = window.open;
  window.open = function (url, name, features) {
    if (typeof url === 'string' && url.indexOf('pinterest.com/pin/create/extension/') !== -1) {
      const manualUrl = getManualDestinationLink({ consume: true });
      const parsed = new URL(url);
      parsed.searchParams.set('url', manualUrl);
      url = parsed.toString();
    }
    return originalOpen.call(window, url, name, features);
  };

  injectManualLinkField();
  new MutationObserver(injectManualLinkField).observe(document.documentElement, { childList: true, subtree: true });
})();
