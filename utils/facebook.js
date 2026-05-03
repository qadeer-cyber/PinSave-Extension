/**
 * utils/facebook.js
 * Heuristics to extract product images and post captions from Facebook.
 * Designed to be robust against Facebook DOM changes by using semantic
 * attributes and content-based rules rather than brittle class names.
 */

// ─── Image Filtering Constants ─────────────────────────────────────────────

const MIN_IMAGE_SIZE = 180; // px — ignore smaller images

// URL-based patterns to skip FB UI/profile images
const IGNORE_URL_PATTERNS = [
  /profpic/i,
  /profile_pic/i,
  /\/profile\//i,
  /emoji/i,
  /sticker/i,
  /reaction/i,
  /like_icon/i,
  /emoticons/i,
  /facebook\.com\/rsrc/i,    // FB static resource CDN
  /static\.xx\.fbcdn\.net\/rsrc/i,
  /fbsbx\.com/i,
  /ads\/image/i,
  /ads_image/i,
  /safe_image\.php/i,         // external link previews (sometimes OK, but often not product)
  /\bsafe_image\b/i,
  /favicon/i,
  /icon\d{1,3}x\d{1,3}/i,   // icon16x16 etc
  /logo/i,
];

// Alt text patterns indicating UI/profile images
const IGNORE_ALT_PATTERNS = [
  /profile picture/i,
  /cover photo/i,
  /avatar/i,
  /reaction/i,
  /like/i,
  /emoji/i,
  /sticker/i,
  /video thumbnail/i,
  /group icon/i,
  /page icon/i,
];

// ─── Image Extraction ──────────────────────────────────────────────────────

/**
 * Collect candidate product images from the current viewport / post area.
 * Returns array of { src, width, height, naturalWidth, naturalHeight, element }.
 *
 * Called from content.js which has DOM access.
 */
function collectCandidateImages() {
  const results = [];
  const seen = new Set();

  // Gather all img elements on page
  const imgs = Array.from(document.querySelectorAll('img'));

  for (const img of imgs) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:') || seen.has(src)) continue;

    // Skip SVG data URIs
    if (src.startsWith('data:image/svg')) continue;

    // Skip by URL patterns
    if (IGNORE_URL_PATTERNS.some(p => p.test(src))) continue;

    // Skip by alt text
    const alt = (img.alt || '').trim();
    if (IGNORE_ALT_PATTERNS.some(p => p.test(alt))) continue;

    // Get rendered size
    const rect = img.getBoundingClientRect();
    const renderedW = rect.width;
    const renderedH = rect.height;

    // Use natural size as fallback
    const natW = img.naturalWidth  || renderedW;
    const natH = img.naturalHeight || renderedH;

    const effW = Math.max(renderedW, natW);
    const effH = Math.max(renderedH, natH);

    if (effW < MIN_IMAGE_SIZE || effH < MIN_IMAGE_SIZE) continue;

    // Skip near-square tiny images that are profile pics even if large
    // (profile pics are often 40–80px rendered but upscaled; filter by natural size)
    if (natW < MIN_IMAGE_SIZE || natH < MIN_IMAGE_SIZE) continue;

    seen.add(src);
    results.push({
      src,
      width: Math.round(effW),
      height: Math.round(effH),
      naturalWidth: natW,
      naturalHeight: natH,
      score: scoreImage(img, src, effW, effH),
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, 12); // Return top 12 candidates
}

/**
 * Score an image to prefer product images.
 * Higher = more likely a product image.
 */
function scoreImage(img, src, w, h) {
  let score = 0;

  // Size bonus
  score += Math.min(w, 1000) / 10;
  score += Math.min(h, 1000) / 10;

  // Portrait/landscape (typical product aspect ratios)
  const ratio = w / h;
  if (ratio >= 0.5 && ratio <= 2.5) score += 20;

  // CDN patterns that indicate real post images (not ads/UI)
  if (/scontent/.test(src)) score += 30;
  if (/fbcdn\.net/.test(src) && !/rsrc/.test(src)) score += 20;

  // Proximity to post area — check if inside a known post container
  // Use role and aria attributes as stable signals
  const postAncestor = img.closest('[role="article"], [data-pagelet*="FeedUnit"], [data-testid*="post"]');
  if (postAncestor) score += 40;

  // Check nearby text for deal keywords (fast check on parent text)
  const nearbyText = (img.closest('[role="article"]') || img.parentElement || document.body).textContent || '';
  if (/amazon\.com|amzn\.to|a\.co/i.test(nearbyText)) score += 50;
  if (/\boff\b|\bdeal\b|\bcoupon\b|\bprice\b/i.test(nearbyText)) score += 20;

  // Penalise if inside nav, header, sidebar
  const badAncestor = img.closest('nav, header, aside, [role="navigation"], [role="banner"], [role="complementary"]');
  if (badAncestor) score -= 80;

  return score;
}

// ─── Caption Extraction ────────────────────────────────────────────────────

const DEAL_SIGNALS = [
  'amazon', 'amzn.to', 'a.co', '#ad', '[ad]',
  'deal', 'coupon', 'code', 'price drop', 'lightning',
  'use:', 'half off', 'off', 'discount', 'sale', 'free',
  'grab', 'shop', 'link', 'get yours', 'checkout', 'check out'
];

/**
 * Extract the best post caption from the page.
 * Strategy:
 *  1. Find [role="article"] containers.
 *  2. Within each, look for text nodes / spans that contain deal signals.
 *  3. Prefer the container closest to the selected image (if provided).
 *  4. Combine adjacent text blocks into one caption.
 *  5. Exclude comments section.
 *
 * @param {Element|null} nearImageEl - An img element to bias towards (optional)
 * @returns {string} Combined post caption
 */
function extractPostCaption(nearImageEl) {
  // Try to find the article/post container
  let postContainers = Array.from(document.querySelectorAll('[role="article"]'));

  // If near an image, prefer that image's ancestor article
  if (nearImageEl) {
    const articleAncestor = nearImageEl.closest('[role="article"]');
    if (articleAncestor) {
      postContainers = [articleAncestor, ...postContainers.filter(c => c !== articleAncestor)];
    }
  }

  for (const container of postContainers) {
    const text = extractTextFromPostContainer(container);
    if (text && DEAL_SIGNALS.some(sig => text.toLowerCase().includes(sig))) {
      return text;
    }
  }

  // Fallback: scan all visible text blocks on page for deal signals
  return extractFallbackCaption();
}

/**
 * Extract clean text from a post container element.
 * Excludes: comments, reaction bars, share buttons, timestamps.
 */
function extractTextFromPostContainer(container) {
  // Remove known non-content areas by cloning and stripping
  const clone = container.cloneNode(true);

  // Remove comment section — typically after a horizontal rule or a [aria-label*="comment"] container
  const commentSelectors = [
    '[aria-label*="comment" i]',
    '[aria-label*="Comment" i]',
    '[data-testid*="comment"]',
    '[role="complementary"]',
  ];
  commentSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });

  // Remove reaction/like bars (often role="toolbar")
  clone.querySelectorAll('[role="toolbar"], [aria-label*="reaction" i], [aria-label*="like" i]').forEach(el => el.remove());

  // Remove action links (share, like, comment buttons)
  clone.querySelectorAll('[role="button"]').forEach(el => {
    const txt = el.textContent.trim().toLowerCase();
    if (['like', 'comment', 'share', 'send', 'follow', 'more'].includes(txt)) el.remove();
  });

  // Collect remaining text
  const rawText = clone.innerText || clone.textContent || '';
  return collapseWhitespace(rawText);
}

/**
 * Fallback: scan whole body for text blocks containing deal signals.
 */
function extractFallbackCaption() {
  const allText = Array.from(document.querySelectorAll('div, p, span'))
    .filter(el => {
      const txt = el.textContent.trim();
      return txt.length > 20 && DEAL_SIGNALS.some(s => txt.toLowerCase().includes(s));
    })
    .sort((a, b) => b.textContent.length - a.textContent.length);

  if (allText.length === 0) return '';
  return collapseWhitespace(allText[0].textContent);
}

/**
 * Collapse excessive whitespace while preserving meaningful line breaks.
 */
function collapseWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')        // max 2 consecutive newlines
    .trim();
}

if (typeof module !== 'undefined') {
  module.exports = { collectCandidateImages, extractPostCaption, scoreImage, collapseWhitespace };
}
