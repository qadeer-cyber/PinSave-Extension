/**
 * content.js
 * Injected into Facebook pages.
 *
 * Responsibilities:
 *  1. On message from popup: scan page for product images + captions, send back.
 *  2. Optionally add hover "Pin Affiliate" button on detected product images.
 */

(() => {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────

  const MIN_SIZE = 180;

  const IGNORE_URL_RE = [
    /profpic|profile_pic|\/profile\//i,
    /emoji|sticker|reaction|like_icon|emoticons/i,
    /facebook\.com\/rsrc|static\.xx\.fbcdn\.net\/rsrc/i,
    /fbsbx\.com|ads\/image|ads_image/i,
    /favicon|logo/i,
    /icon\d{2,3}x\d{2,3}/i,
  ];

  const IGNORE_ALT_RE = [
    /profile picture|cover photo|avatar/i,
    /reaction|like|emoji|sticker|group icon|page icon/i,
  ];

  const DEAL_SIGNALS = [
    'amazon', 'amzn.to', 'a.co', '#ad', '[ad]',
    'deal', 'coupon', 'code', 'price drop', 'lightning',
    'use:', 'half off', 'off', 'discount', 'sale',
  ];

  const AMAZON_URL_RE = /https?:\/\/(?:www\.)?(?:amzn\.to|a\.co|amzn\.com|amazon(?:\.com(?:\.au|\.br|\.mx)?|\.co(?:\.uk|\.jp)?|\.ca|\.de|\.fr|\.it|\.es|\.in))[^\s"'<>)}\]]+/gi;

  let hoverButtonsEnabled = false;
  let hoverObserver = null;

  // ─── Image Scoring & Collection ────────────────────────────────────────────

  function isIgnoredSrc(src) {
    return IGNORE_URL_RE.some(re => re.test(src));
  }

  function isIgnoredAlt(alt) {
    return IGNORE_ALT_RE.some(re => re.test(alt || ''));
  }

  function scoreImage(img, src) {
    let score = 0;
    const rect  = img.getBoundingClientRect();
    const w     = Math.max(img.naturalWidth  || 0, rect.width  || 0);
    const h     = Math.max(img.naturalHeight || 0, rect.height || 0);

    score += Math.min(w, 1000) / 10 + Math.min(h, 1000) / 10;

    const ratio = w / h;
    if (ratio >= 0.5 && ratio <= 2.5) score += 20;

    if (/scontent/.test(src))                              score += 30;
    if (/fbcdn\.net/.test(src) && !/rsrc/.test(src))       score += 20;

    if (img.closest('[role="article"]'))                   score += 40;

    const container = img.closest('[role="article"]') || img.parentElement || document.body;
    const nearText  = container.textContent || '';
    if (/amazon\.com|amzn\.to|a\.co/i.test(nearText))     score += 50;
    if (/\boff\b|\bdeal\b|\bcoupon\b|\bprice\b/i.test(nearText)) score += 20;

    if (img.closest('nav, header, aside, [role="navigation"], [role="banner"], [role="complementary"]')) score -= 80;

    return score;
  }

  function collectImages() {
    const results = [];
    const seen    = new Set();

    document.querySelectorAll('img').forEach(img => {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:') || seen.has(src)) return;
      if (isIgnoredSrc(src))  return;
      if (isIgnoredAlt(img.alt)) return;

      const rect = img.getBoundingClientRect();
      const w    = Math.max(img.naturalWidth  || 0, rect.width  || 0);
      const h    = Math.max(img.naturalHeight || 0, rect.height || 0);

      if (w < MIN_SIZE || h < MIN_SIZE) return;

      seen.add(src);
      results.push({
        src,
        width:         Math.round(w),
        height:        Math.round(h),
        naturalWidth:  img.naturalWidth,
        naturalHeight: img.naturalHeight,
        score:         scoreImage(img, src),
      });
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 12);
  }

  // ─── Caption Extraction ────────────────────────────────────────────────────

  function extractCaption(preferNearSrc) {
    let articles = Array.from(document.querySelectorAll('[role="article"]'));

    if (preferNearSrc) {
      // Find the article containing the image with this src
      // Avoid brittle CSS selectors because Facebook image URLs contain characters
      // that can break querySelector. Compare currentSrc/src directly instead.
      const imgEl = Array.from(document.querySelectorAll('img')).find(img =>
        (img.currentSrc || img.src || '') === preferNearSrc || img.src === preferNearSrc
      );
      if (imgEl) {
        const ancestor = imgEl.closest('[role="article"]');
        if (ancestor) articles = [ancestor, ...articles.filter(a => a !== ancestor)];
      }
    }

    for (const article of articles) {
      const text = extractFromArticle(article);
      if (text && DEAL_SIGNALS.some(s => text.toLowerCase().includes(s))) {
        return collapseWhitespace(text);
      }
    }

    return extractFallback();
  }

  function extractFromArticle(article) {
    // Clone to strip non-content elements without mutating DOM
    const clone = article.cloneNode(true);

    // Remove comments section
    clone.querySelectorAll(
      '[aria-label*="comment" i], [aria-label*="Comment" i], [data-testid*="comment"], [role="complementary"]'
    ).forEach(el => el.remove());

    // Remove reaction bars
    clone.querySelectorAll('[role="toolbar"], [aria-label*="reaction" i]').forEach(el => el.remove());

    // Remove interaction buttons
    clone.querySelectorAll('[role="button"]').forEach(el => {
      const t = el.textContent.trim().toLowerCase();
      if (['like', 'comment', 'share', 'send', 'follow', 'more'].includes(t)) el.remove();
    });

    return clone.innerText || clone.textContent || '';
  }

  function extractFallback() {
    const blocks = Array.from(document.querySelectorAll('div, p, span'))
      .filter(el => {
        const t = el.textContent.trim();
        return t.length > 20 && DEAL_SIGNALS.some(s => t.toLowerCase().includes(s));
      })
      .sort((a, b) => b.textContent.length - a.textContent.length);

    return blocks.length ? collapseWhitespace(blocks[0].textContent) : '';
  }

  function collapseWhitespace(t) {
    return t.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ─── Amazon URL Extraction from Caption ───────────────────────────────────

  function findAmazonUrls(text) {
    const matches = text.match(AMAZON_URL_RE) || [];
    return [...new Set(matches.map(u => u.replace(/[.,;!?]+$/, '')))];
  }

  // ─── Hover Pin Button ──────────────────────────────────────────────────────

  /**
   * Build a "quick capture" payload from a clicked product image element.
   * Captures the exact image src + the caption / Amazon links from the SAME
   * Facebook post container (not comments, sidebar, or other posts).
   */
  function buildQuickCapture(imgEl) {
    const src        = (imgEl && (imgEl.currentSrc || imgEl.src)) || '';
    const currentSrc = (imgEl && imgEl.currentSrc) || '';

    let caption    = '';
    let amazonUrls = [];

    // Restrict caption extraction to the post container that holds the
    // clicked image. Falls back to the whole-page extractor if the article
    // can't be found.
    const article = imgEl && imgEl.closest('[role="article"]');
    if (article) {
      const text = extractFromArticle(article);
      caption    = collapseWhitespace(text);
      amazonUrls = findAmazonUrls(caption);
    } else {
      caption    = extractCaption(src);
      amazonUrls = findAmazonUrls(caption);
    }

    return {
      src,
      currentSrc,
      caption,
      amazonUrls,
      capturedAt: Date.now(),
    };
  }

  function addHoverButtons() {
    document.querySelectorAll('[role="article"]').forEach(article => {
      article.querySelectorAll('img').forEach(img => {
        if (img.dataset.afpinHover) return; // already tagged

        const src = img.currentSrc || img.src || '';
        if (!src || isIgnoredSrc(src) || isIgnoredAlt(img.alt)) return;

        const w = Math.max(img.naturalWidth || 0, img.getBoundingClientRect().width || 0);
        const h = Math.max(img.naturalHeight || 0, img.getBoundingClientRect().height || 0);
        if (w < MIN_SIZE || h < MIN_SIZE) return;

        img.dataset.afpinHover = '1';

        // Wrap in relative container if needed
        const wrapper = img.parentElement;
        if (!wrapper) return;

        const btn = document.createElement('button');
        btn.className = 'afpin-hover-btn';
        btn.textContent = 'Pin Affiliate';
        btn.title      = 'Save this image as affiliate pin';

        // Bind the actual <img> element so the handler always knows which
        // image / post container the user clicked on.
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();

          const payload = buildQuickCapture(img);

          // We can't open the popup from a content script in MV3, so we
          // stash the payload in session storage and let the popup pick it
          // up on next open. Also keep the legacy `hoverSelectedSrc` key
          // for backwards compatibility.
          chrome.storage.session.set({
            quickCapture:     payload,
            hoverSelectedSrc: payload.src,
          }).then(() => {
            chrome.runtime.sendMessage({ action: 'hoverImageSelected', src: payload.src })
              .catch(() => {});
          });
        });

        const wStyle = getComputedStyle(wrapper);
        if (wStyle.position === 'static') wrapper.style.position = 'relative';

        wrapper.appendChild(btn);
      });
    });
  }

  function initHoverButtons(enabled) {
    hoverButtonsEnabled = enabled;
    if (!enabled) {
      // Remove existing buttons
      document.querySelectorAll('.afpin-hover-btn').forEach(b => b.remove());
      if (hoverObserver) { hoverObserver.disconnect(); hoverObserver = null; }
      return;
    }

    addHoverButtons();

    // Watch for new images added dynamically
    hoverObserver = new MutationObserver(muts => {
      const relevant = muts.some(m => m.addedNodes.length > 0);
      if (relevant) addHoverButtons();
    });
    hoverObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

    if (msg.action === 'scanPage') {
      try {
        const images  = collectImages();
        const caption = extractCaption(null);
        const urls    = findAmazonUrls(caption);
        sendResponse({ success: true, images, caption, amazonUrls: urls });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return false;
    }

    if (msg.action === 'extractCaption') {
      try {
        const caption = extractCaption(msg.nearSrc || null);
        const urls    = findAmazonUrls(caption);
        sendResponse({ success: true, caption, amazonUrls: urls });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return false;
    }

    if (msg.action === 'setHoverButtons') {
      initHoverButtons(msg.enabled);
      sendResponse({ success: true });
      return false;
    }

    if (msg.action === 'openHoverPanel') {
      // Context menu triggered with a src URL — find the matching <img> in
      // the DOM so we can build the same quick-capture payload we'd build
      // from the hover button.
      try {
        if (msg.srcUrl) {
          const imgEl = Array.from(document.querySelectorAll('img')).find(i =>
            (i.currentSrc || i.src || '') === msg.srcUrl || i.src === msg.srcUrl
          ) || null;
          const payload = imgEl
            ? buildQuickCapture(imgEl)
            : { src: msg.srcUrl, currentSrc: '', caption: '', amazonUrls: [], capturedAt: Date.now() };
          chrome.storage.session.set({
            quickCapture:     payload,
            hoverSelectedSrc: payload.src,
          });
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return false;
    }

  });

  // ─── Init ──────────────────────────────────────────────────────────────────

  // Read settings on load
  chrome.storage.local.get(['hoverButtonsEnabled']).then(data => {
    if (data.hoverButtonsEnabled) initHoverButtons(true);
  });

})();
