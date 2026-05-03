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

  // ─── Defensive helpers ─────────────────────────────────────────────────────

  /**
   * Coerce a value to a non-empty trimmed string. Returns the fallback when the
   * value is null/undefined/empty/whitespace OR is the literal string
   * "undefined" / "null" (which can happen when callers do
   *   `'foo ' + product.title` and `product.title` is undefined).
   *
   * Used everywhere we render dynamic text into the hover button so a missing
   * field never leaks the word "undefined" into the UI.
   */
  function safeText(value, fallback = 'Pin Affiliate') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).trim();
    if (!s || /^(undefined|null)$/i.test(s)) return fallback;
    return s;
  }

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

  /**
   * Selector for elements that should NEVER count as a "post container"
   * (comments, navigation, suggested-content rails, group menus, etc).
   */
  const NON_POST_SELECTOR = [
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[role="search"]',
    '[role="dialog"]',
    'nav',
    'header',
    'aside',
    'footer',
    '[aria-label*="comment" i]',
    '[aria-label*="Comments" i]',
    '[data-testid*="comment" i]',
    '[aria-label*="suggest" i]',
    '[aria-label*="Suggested" i]',
    '[aria-label*="People you may know" i]',
    '[aria-label*="Sponsored" i]',
  ].join(',');

  /**
   * Find the "best" Facebook post/feed-unit container that holds the given
   * element. Climbs parents, scoring candidate containers, and returns the
   * smallest one that:
   *   - actually contains the clicked image
   *   - has visible meaningful text
   *   - is not a comment / sidebar / nav / suggested-post container
   *   - ideally contains an Amazon link or a deal keyword
   *
   * Falls back to `[role="article"]` ancestor if scoring finds nothing.
   */
  function findPostContainer(el) {
    if (!el || !el.parentElement) return null;
    if (el.closest && el.closest(NON_POST_SELECTOR)) {
      // The element itself sits inside a comment / sidebar / nav. Bail out
      // — we shouldn't be quick-capturing from there.
      const inAside = el.closest('aside, [role="complementary"], [role="navigation"]');
      if (inAside) return null;
    }

    const candidates = [];
    const visited = new Set();
    let node = el.parentElement;
    let depth = 0;

    while (node && node !== document.body && depth < 30) {
      depth++;
      if (visited.has(node)) break;
      visited.add(node);

      // Skip non-post regions outright.
      if (node.matches && node.matches(NON_POST_SELECTOR)) {
        node = node.parentElement;
        continue;
      }

      const role        = (node.getAttribute && node.getAttribute('role')) || '';
      const isArticle   = role === 'article';
      const isFeedUnit  = role === 'feed' || role === 'main';
      const tag         = node.tagName ? node.tagName.toLowerCase() : '';
      const isArticleTag = tag === 'article';

      // Cheap visible-text snapshot (innerText is layout-aware on real pages
      // but we already fall back to textContent for safety).
      const rawText = (node.innerText || node.textContent || '').trim();
      if (!rawText) {
        node = node.parentElement;
        continue;
      }

      // Skip extremely large containers (whole feed) unless nothing smaller
      // qualifies — huge containers tend to absorb other posts.
      const textLen = rawText.length;

      let score = 0;
      if (isArticle || isArticleTag) score += 100;
      if (isFeedUnit)                score += 20;
      if (textLen >= 60)             score += 10;
      if (textLen >= 200)            score += 5;
      if (textLen > 4000)            score -= 30; // probably the whole feed
      if (DEAL_SIGNALS.some(s => rawText.toLowerCase().includes(s))) score += 30;

      candidates.push({ node, score, textLen, isArticle: isArticle || isArticleTag });

      // Stop climbing once we've found an explicit article ancestor; going
      // higher only risks pulling other posts in.
      if (isArticle || isArticleTag) break;

      node = node.parentElement;
    }

    if (candidates.length === 0) return null;

    // Prefer explicit articles, then highest score, then smallest text.
    candidates.sort((a, b) => {
      if (a.isArticle !== b.isArticle) return a.isArticle ? -1 : 1;
      if (b.score !== a.score)         return b.score - a.score;
      return a.textLen - b.textLen;
    });

    return candidates[0].node;
  }

  /**
   * Extract clean caption text from a post container, stripping comments,
   * reaction bars, suggested-post rails, navigation chrome, etc.
   */
  function extractFromArticle(article) {
    if (!article) return '';

    // Clone so we can prune without mutating the live DOM.
    const clone = article.cloneNode(true);

    // Remove anything that obviously isn't post body text.
    clone.querySelectorAll(NON_POST_SELECTOR).forEach(el => el.remove());

    // Remove reaction toolbars and "X comments / Y shares" footer rows.
    clone.querySelectorAll('[role="toolbar"], [aria-label*="reaction" i], [aria-label*="Reaction" i]')
      .forEach(el => el.remove());

    // Remove like/comment/share/follow buttons that survived above.
    clone.querySelectorAll('[role="button"]').forEach(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (['like', 'comment', 'share', 'send', 'follow', 'more', 'see more', 'see translation'].includes(t)) {
        el.remove();
      }
    });

    return (clone.innerText || clone.textContent || '').trim();
  }

  /**
   * Page-wide caption extraction. Used by the popup's initial scan and as a
   * fallback when no post container can be located near the chosen image.
   */
  function extractCaption(preferNearSrc) {
    if (preferNearSrc) {
      const imgEl = Array.from(document.querySelectorAll('img')).find(img =>
        (img.currentSrc || img.src || '') === preferNearSrc || img.src === preferNearSrc
      );
      if (imgEl) {
        const container = findPostContainer(imgEl);
        if (container) {
          const text = extractFromArticle(container);
          if (text) return collapseWhitespace(text);
        }
      }
    }

    // Generic fall-through: search known post containers for one that
    // looks like a deal post.
    const articles = Array.from(document.querySelectorAll('[role="article"], article'));
    for (const article of articles) {
      const text = extractFromArticle(article);
      if (text && DEAL_SIGNALS.some(s => text.toLowerCase().includes(s))) {
        return collapseWhitespace(text);
      }
    }

    return extractFallback();
  }

  function extractFallback() {
    const blocks = Array.from(document.querySelectorAll('div, p, span'))
      .filter(el => {
        if (el.closest && el.closest(NON_POST_SELECTOR)) return false;
        const t = (el.textContent || '').trim();
        return t.length > 20 && DEAL_SIGNALS.some(s => t.toLowerCase().includes(s));
      })
      .sort((a, b) => b.textContent.length - a.textContent.length);

    return blocks.length ? collapseWhitespace(blocks[0].textContent) : '';
  }

  function collapseWhitespace(t) {
    return (t || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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

    let caption        = '';
    let amazonUrls     = [];
    let containerKind  = 'none';

    // Restrict caption extraction to the SAME post container that holds the
    // clicked image. The findPostContainer helper climbs parents, scores
    // candidates, and rejects comments/sidebars/nav/suggested rails.
    const container = imgEl ? findPostContainer(imgEl) : null;
    if (container) {
      const role = (container.getAttribute && container.getAttribute('role')) || '';
      const tag  = container.tagName ? container.tagName.toLowerCase() : '';
      containerKind = (role === 'article' || tag === 'article') ? 'article'
                    : (role === 'feed' || role === 'main')      ? 'feed'
                    : 'scored';
      const text = extractFromArticle(container);
      caption    = collapseWhitespace(text);
      amazonUrls = findAmazonUrls(caption);
    } else {
      // Fall back to page-wide extractor — flags as fallback so the popup
      // can show a "may be wrong post" warning in the Capture Status.
      caption       = extractCaption(src);
      amazonUrls    = findAmazonUrls(caption);
      containerKind = 'page-fallback';
    }

    return {
      mode: 'quick',
      source: 'Quick Capture',
      selectedImageUrl: src,
      src, // legacy compatibility
      currentSrc,
      caption,
      amazonUrls,
      containerKind,
      // Mark this payload as a single-image quick capture so the popup never
      // pulls a full page image gallery on top of the user's selected image.
      singleImage: true,
      sourceFacebookUrl: location.href,
      capturedAt: new Date().toISOString(),
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
        // Always-defined hover label — never inject dynamic product titles
        // here. If a future caller wants a per-image label, route it through
        // safeText() so missing values fall back to "Pin Affiliate" and we
        // never render the literal string "undefined".
        btn.textContent = safeText('Pin Affiliate', 'Pin Affiliate');
        btn.title      = safeText('Pin Affiliate', 'Pin Affiliate');
        btn.setAttribute('aria-label', safeText('Pin Affiliate', 'Pin Affiliate'));
        btn.type       = 'button';

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

        // Mark the wrapper so content.css can show the button on hover via a
        // simple `[data-afpin-host]:hover .afpin-hover-btn` selector that does
        // not depend on direct-child relationships.
        wrapper.setAttribute('data-afpin-host', '1');

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

    if (msg.action === 'ping') {
      sendResponse({ success: true, version: 'content-1.4.1', host: location.hostname });
      return false;
    }

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
        // Phase 2.1: prefer the per-image post container so caption
        // extraction stays scoped to the same post that holds the image.
        let caption       = '';
        let urls          = [];
        let containerKind = null;
        const nearSrc     = msg.nearSrc || null;

        if (nearSrc) {
          const imgEl = Array.from(document.querySelectorAll('img')).find(img =>
            (img.currentSrc || img.src || '') === nearSrc || img.src === nearSrc
          );
          const container = imgEl ? findPostContainer(imgEl) : null;
          if (container) {
            const role = (container.getAttribute && container.getAttribute('role')) || '';
            const tag  = container.tagName ? container.tagName.toLowerCase() : '';
            containerKind = (role === 'article' || tag === 'article') ? 'article'
                          : (role === 'feed' || role === 'main')      ? 'feed'
                          : 'scored';
            caption = collapseWhitespace(extractFromArticle(container));
            urls    = findAmazonUrls(caption);
          }
        }

        if (!caption) {
          caption       = extractCaption(nearSrc);
          urls          = findAmazonUrls(caption);
          containerKind = caption ? 'page-fallback' : null;
        }

        sendResponse({ success: true, caption, amazonUrls: urls, containerKind });
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

  // Read settings on load. Hover buttons default to ON when the user has not
  // saved a preference yet, so the extension is useful out of the box.
  chrome.storage.local.get(['hoverButtonsEnabled']).then(data => {
    const enabled = data && Object.prototype.hasOwnProperty.call(data, 'hoverButtonsEnabled')
      ? !!data.hoverButtonsEnabled
      : true;
    if (enabled) initHoverButtons(true);
  });

})();
