/**
 * background.js
 * Chrome Extension Service Worker (Manifest V3).
 *
 * Responsibilities:
 *  - Listen for messages from popup.js / content.js
 *  - Resolve short Amazon URLs (amzn.to / a.co) by following redirects
 *  - Context menu registration
 */

// ─── Context Menu ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id:       'affiliate-pin-saver-open',
    title:    'Save to Pinterest (Affiliate)',
    contexts: ['page', 'image'],
    documentUrlPatterns: [
      'https://facebook.com/*',
      'https://www.facebook.com/*',
      'https://m.facebook.com/*',
      'https://web.facebook.com/*'
    ],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'affiliate-pin-saver-open') {
    chrome.tabs.sendMessage(tab.id, { action: 'openHoverPanel', srcUrl: info.srcUrl || null }).catch(() => {});
  }
});

// ─── Message Handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Resolve a short Amazon URL by following redirects
  if (msg.action === 'resolveShortUrl') {
    resolveShortUrl(msg.url)
      .then(resolved => sendResponse({ success: true, resolvedUrl: resolved }))
      .catch(err   => sendResponse({ success: false, error: err.message }));
    return true; // keep message channel open for async
  }

  // Open a URL in new tab
  if (msg.action === 'openTab') {
    chrome.tabs.create({ url: msg.url, active: true });
    sendResponse({ success: true });
    return false;
  }

});

// ─── Short URL Resolver ────────────────────────────────────────────────────

/**
 * Resolve a short Amazon URL (amzn.to / a.co) to its full destination URL.
 * @param {string} url
 * @returns {Promise<string>} Resolved URL
 */
async function resolveShortUrl(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetch(url, { method, redirect: 'follow' });
      if (response.url) return response.url;
    } catch (e) {
      if (method === 'GET') {
        throw new Error(`Network error resolving URL: ${e.message}`);
      }
    }
  }

  throw new Error('Could not resolve short URL.');
}
