/*
 * dashboardLogger.js
 *
 * Content script: runs on Pinterest's create-pin URL whenever the manual
 * destination link extension opens it. Captures the pin metadata from the
 * URL query string and appends a record to chrome.storage.local.pin_history
 * for the analytics dashboard.
 *
 * This script does not modify any pin behavior - it only observes and logs.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'pin_history';
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

  function buildRecord() {
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

    chrome.storage.local.get([STORAGE_KEY], function (items) {
      const history = Array.isArray(items[STORAGE_KEY]) ? items[STORAGE_KEY] : [];
      if (isDuplicate(history, record)) return;

      history.push(record);
      while (history.length > MAX_RECORDS) history.shift();

      const update = {};
      update[STORAGE_KEY] = history;
      chrome.storage.local.set(update);
    });
  }

  function logOnce() {
    const record = buildRecord();
    if (record) appendRecord(record);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', logOnce, { once: true });
  } else {
    logOnce();
  }
})();
