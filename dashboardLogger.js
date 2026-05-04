/*
 * dashboardLogger.js
 *
 * Content script: runs on Pinterest's create-pin URL whenever the manual
 * destination link extension opens it. Captures the pin metadata from the
 * URL query string, applies any manually-entered title from
 * chrome.storage.local.pbe_pending_title (filling Pinterest's title input
 * directly), and appends a record to chrome.storage.local.pin_history for
 * the analytics dashboard.
 *
 * This script does not modify any pin behavior beyond filling the title
 * field; everything else is observe-and-log.
 */
(function () {
  'use strict';

  const HISTORY_KEY = 'pin_history';
  const TITLE_KEY = 'pbe_pending_title';
  const TITLE_TTL_MS = 5 * 60 * 1000;
  const TITLE_FILL_TIMEOUT_MS = 15 * 1000;
  const DEDUPE_WINDOW_MS = 60 * 1000;
  const MAX_RECORDS = 5000;

  function safeUrl(value) {
    try {
      return new URL(value);
    } catch (e) {
      return null;
    }
  }

  function parseAmazonInfo(destinationUrl) {
    const parsed = safeUrl(destinationUrl);
    if (!parsed) return { domain: null, marketplace: null, asin: null, tag: null };

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const isAmazon = /(^|\.)amazon\./.test(host);

    let asin = null;
    if (isAmazon) {
      const m = parsed.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})/i);
      if (m) asin = m[1].toUpperCase();
    }

    const tag = parsed.searchParams.get('tag');

    return {
      domain: host,
      marketplace: isAmazon ? host : null,
      asin,
      tag: tag || null
    };
  }

  function buildRecord(extra) {
    const here = safeUrl(window.location.href);
    if (!here) return null;

    const params = here.searchParams;
    const destinationUrl = params.get('url') || '';
    const imageUrl = params.get('media') || params.get('image') || '';
    const description = params.get('description') || '';
    const sourceUrl = params.get('refUrl') || params.get('source_url') || params.get('referer') || '';
    const method = params.get('method') || '';

    if (!destinationUrl && !imageUrl) return null;

    const amazon = parseAmazonInfo(destinationUrl);

    return {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      destinationUrl,
      imageUrl,
      description,
      title: (extra && extra.title) || '',
      sourceUrl,
      method,
      domain: amazon.domain,
      marketplace: amazon.marketplace,
      asin: amazon.asin,
      affiliateTag: amazon.tag,
      pageHref: here.href
    };
  }

  function isDuplicate(history, record) {
    if (!history || !history.length || !record) return false;
    const cutoff = record.timestamp - DEDUPE_WINDOW_MS;
    for (let i = history.length - 1; i >= 0; i--) {
      const prev = history[i];
      if (prev.timestamp < cutoff) return false;
      if (prev.destinationUrl === record.destinationUrl &&
          prev.imageUrl === record.imageUrl) {
        return true;
      }
    }
    return false;
  }

  function appendRecord(record) {
    if (!record) return;
    if (!chrome || !chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get([HISTORY_KEY], function (items) {
      const history = Array.isArray(items[HISTORY_KEY]) ? items[HISTORY_KEY] : [];
      if (isDuplicate(history, record)) return;

      history.push(record);
      while (history.length > MAX_RECORDS) history.shift();

      const update = {};
      update[HISTORY_KEY] = history;
      chrome.storage.local.set(update);
    });
  }

  /* ---------- Pinterest title-field filler ---------- */

  /*
   * Best-effort selectors for Pinterest's pin-builder title input. Pinterest's
   * React app uses dynamic class names, so we go from most-specific to
   * generic. We also exclude known non-title fields (search, descriptions,
   * etc.) when scanning.
   */
  const TITLE_SELECTORS = [
    'textarea[data-test-id="pin-draft-title"]',
    'textarea[aria-label="Title"]',
    'textarea[aria-label*="title" i]',
    'input[aria-label="Title"]',
    'input[aria-label*="title" i]',
    'textarea[name="title"]',
    'input[name="title"]',
    'textarea[placeholder*="title" i]',
    'input[placeholder*="title" i]',
    '[data-test-id*="title" i] textarea',
    '[data-test-id*="title" i] input'
  ];

  function findTitleInput() {
    for (let i = 0; i < TITLE_SELECTORS.length; i++) {
      const els = document.querySelectorAll(TITLE_SELECTORS[i]);
      for (let j = 0; j < els.length; j++) {
        const el = els[j];
        if (!el || el.disabled || el.readOnly) continue;
        // Skip Pinterest's global search box.
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        if (aria.indexOf('search') !== -1) continue;
        if (placeholder.indexOf('search') !== -1) continue;
        if (name === 'searchboxinput') continue;
        if (aria.indexOf('description') !== -1) continue;
        return el;
      }
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) {
      setter.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillTitleWhenReady(title, doneCallback) {
    if (!title) { doneCallback(false); return; }

    let done = false;
    function tryFill() {
      if (done) return true;
      const el = findTitleInput();
      if (!el) return false;
      try {
        el.focus();
        setNativeValue(el, title);
        done = true;
        doneCallback(true);
        return true;
      } catch (e) {
        return false;
      }
    }

    if (tryFill()) return;

    const observer = new MutationObserver(function () {
      if (tryFill() && observer) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(function () {
      if (!done) {
        observer.disconnect();
        doneCallback(false);
      }
    }, TITLE_FILL_TIMEOUT_MS);
  }

  function consumePendingTitle(callback) {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      callback(null);
      return;
    }
    chrome.storage.local.get([TITLE_KEY], function (items) {
      const stash = items[TITLE_KEY];
      if (!stash || typeof stash !== 'object') { callback(null); return; }
      const fresh = stash.timestamp && (Date.now() - stash.timestamp < TITLE_TTL_MS);
      const title = fresh && typeof stash.title === 'string' ? stash.title.trim() : '';
      // Always clear stale or used stash so it doesn't apply on a future page.
      chrome.storage.local.remove(TITLE_KEY, function () {
        callback(title || null);
      });
    });
  }

  /* ---------- bootstrap ---------- */

  function run() {
    consumePendingTitle(function (title) {
      const record = buildRecord({ title: title || '' });
      if (record) appendRecord(record);
      if (title) fillTitleWhenReady(title, function () { /* no-op */ });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
