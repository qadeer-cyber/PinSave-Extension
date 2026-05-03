/**
 * utils/quality.js — Phase 4 Pin Quality Scoring + Auto-Fix.
 *
 * Scores a pin payload 0–100 against the Phase 4 quality rubric, surfaces
 * human-readable warnings, and provides a non-destructive auto-fix that
 * fills in common gaps (disclosure, deal disclaimer, board, alt text,
 * de-duped/limited hashtags).
 *
 * No external API calls. No analytics. No auto-publishing. Auto-fix never
 * invents Amazon affiliate links — if there's no Amazon URL, the
 * affiliate field stays empty.
 *
 * Public surface (browser globals + Node module exports):
 *   - scorePinPackage(pinData)
 *   - getQualityWarnings(pinData)
 *   - autoFixPinPackage(pinData, options?)
 *   - QUALITY_GOOD_THRESHOLD
 *   - QUALITY_NEEDS_REVIEW_THRESHOLD
 */

'use strict';

const QUALITY_GOOD_THRESHOLD          = 80;   // 80+ = ready
const QUALITY_NEEDS_REVIEW_THRESHOLD  = 70;   // popup save warning fires below this

// Hashtag count target window per the spec.
const HASHTAG_MIN = 5;
const HASHTAG_MAX = 12;

// Title length cap per Pinterest convention.
const TITLE_MAX = 100;

// ─── Helpers ───────────────────────────────────────────────────────────────

function _str(v) {
  return v == null ? '' : String(v);
}

function _trim(v) {
  return _str(v).trim();
}

/**
 * Split a hashtag field into individual tags. Accepts arrays, comma- or
 * whitespace-separated strings. Always returns an array of trimmed
 * non-empty tokens (with the leading # preserved if present).
 */
function _splitHashtags(value) {
  if (Array.isArray(value)) {
    return value.map(t => _trim(t)).filter(Boolean);
  }
  const s = _trim(value);
  if (!s) return [];
  return s.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
}

/**
 * Re-emit a hashtag list back as a single space-separated string, with
 * each tag normalised to start with `#` and stripped of invalid chars.
 */
function _formatHashtags(tags) {
  const out = [];
  for (const raw of tags) {
    let s = _trim(raw);
    if (!s) continue;
    if (!s.startsWith('#')) s = '#' + s;
    s = s.replace(/[^#A-Za-z0-9_]/g, '');
    if (s.length < 2) continue;
    out.push(s);
  }
  return out.join(' ').trim();
}

/**
 * Detect obviously bad image URLs (blob:, data:, very short). Mirrors the
 * popup's evaluateImageUrl heuristics so the queue dashboard can surface
 * the same warning offline.
 */
function _imageUrlMaybeBroken(url) {
  if (!url) return false; // missing image is its own concern
  const u = _trim(url);
  if (!u) return false;
  if (/^blob:/i.test(u)) return true;
  if (/^data:/i.test(u)) return true;
  if (u.length < 24) return true;
  return false;
}

/**
 * Does the affiliate URL include an Amazon Associate `tag=` query
 * parameter? Plain string check — we don't try to validate the actual
 * tag value. Empty string returns false.
 */
function _hasAmazonTag(url) {
  if (!url) return false;
  return /[?&]tag=[^&\s]+/i.test(url);
}

/**
 * Lower-cased, trimmed comparison key for hashtag de-dup.
 */
function _tagKey(tag) {
  return _trim(tag).toLowerCase().replace(/^#/, '');
}

// ─── Score ─────────────────────────────────────────────────────────────────

/**
 * Score a pin payload against the Phase 4 rubric. Returns a number in
 * [0, 100].
 *
 * Rules (capped at 100):
 *   - Pinterest title exists                    +10
 *   - Pinterest title under 100 chars           +10
 *   - Pinterest description exists              +15
 *   - Affiliate URL exists                      +20
 *   - Affiliate URL includes tag=               +10
 *   - Disclosure exists (in description)        +15
 *   - Suggested board exists                    +10
 *   - Alt text exists                           +10
 *   - Hashtags count between 5 and 12           +10
 */
function scorePinPackage(pinData) {
  const p = pinData || {};
  let score = 0;

  const title       = _trim(p.pinterestTitle);
  const description = _trim(p.pinterestDescription);
  const affiliate   = _trim(p.affiliateUrl);
  const board       = _trim(p.suggestedBoard);
  const alt         = _trim(p.altText);
  const hashtags    = _splitHashtags(p.hashtags);

  if (title)                          score += 10;
  if (title && title.length <= TITLE_MAX) score += 10;
  if (description)                    score += 15;
  if (affiliate)                      score += 20;
  if (affiliate && _hasAmazonTag(affiliate)) score += 10;

  if (description && /#ad\b/i.test(description)) score += 15;
  else if (description && /amazon associate/i.test(description)) score += 15;

  if (board)                          score += 10;
  if (alt)                            score += 10;
  if (hashtags.length >= HASHTAG_MIN && hashtags.length <= HASHTAG_MAX) score += 10;

  if (score < 0)   score = 0;
  if (score > 100) score = 100;
  return score;
}

// ─── Warnings ──────────────────────────────────────────────────────────────

/**
 * Return an array of human-readable warning strings describing exactly
 * what is missing or off about this pin package. Order is roughly
 * severity-first.
 */
function getQualityWarnings(pinData) {
  const p = pinData || {};
  const out = [];

  const title       = _trim(p.pinterestTitle);
  const description = _trim(p.pinterestDescription);
  const affiliate   = _trim(p.affiliateUrl);
  const board       = _trim(p.suggestedBoard);
  const alt         = _trim(p.altText);
  const tags        = _splitHashtags(p.hashtags);
  const imageUrl    = _trim(p.selectedImageUrl);

  if (!title)                                 out.push('Missing Pinterest title');
  else if (title.length > TITLE_MAX)          out.push('Title too long (over 100 characters)');

  if (!description)                           out.push('Missing description');

  if (!affiliate)                             out.push('Missing affiliate link');
  else if (!_hasAmazonTag(affiliate))         out.push('Affiliate link does not include tag=');

  // Disclosure can live in the description body.
  const hasDisclosure = description &&
    (/#ad\b/i.test(description) || /amazon associate/i.test(description));
  if (!hasDisclosure)                         out.push('Missing affiliate disclosure');

  if (!board)                                 out.push('Missing suggested board');
  if (!alt)                                   out.push('Missing alt text');

  if (tags.length < HASHTAG_MIN)              out.push('Too few hashtags');
  if (tags.length > HASHTAG_MAX)              out.push('Too many hashtags');

  // Duplicate hashtags (case-insensitive).
  const seen = new Set();
  let hasDup = false;
  for (const t of tags) {
    const k = _tagKey(t);
    if (!k) continue;
    if (seen.has(k)) { hasDup = true; break; }
    seen.add(k);
  }
  if (hasDup)                                 out.push('Duplicate hashtags');

  if (_imageUrlMaybeBroken(imageUrl))         out.push('Image URL may not work on Pinterest');

  return out;
}

// ─── Auto-Fix ──────────────────────────────────────────────────────────────

/**
 * Non-destructive auto-fix. Returns a new pinData object with the
 * applicable fixes applied. Never invents an Amazon link. Never modifies
 * fields the user has explicitly populated unless the spec says so
 * (e.g. de-dup hashtags, cap to 12).
 *
 * Optional `options.template` lets the caller pass the active category
 * template so we can fall back to its suggestedBoard when the pin has none.
 * Optional `options.altGenerator` is a synchronous function `(pin) =>
 * string` used to fabricate alt text when missing — typically wired up to
 * the existing generateAltText() in utils/textParser.js.
 */
function autoFixPinPackage(pinData, options = {}) {
  const p = pinData && typeof pinData === 'object' ? { ...pinData } : {};
  const template = options.template || null;

  // 1. Disclosure — append to description if missing.
  const disclosureText = _trim((template && template.disclosureText)
                                || '#ad As an Amazon Associate, I earn from qualifying purchases.');
  let desc = _str(p.pinterestDescription);
  if (desc && !/#ad\b/i.test(desc) && !/amazon associate/i.test(desc)) {
    desc = desc.replace(/\s+$/, '') + '\n\n' + disclosureText;
  } else if (!desc) {
    // No description at all — leave empty so the user notices the warning,
    // but we still seed the disclosure so a quick description edit
    // includes the fix.
    desc = disclosureText;
  }

  // 2. Deal disclaimer — append if missing.
  const dealDisclaimer = _trim((template && template.dealDisclaimer)
                                || 'Prices, deals, and coupon codes may change or end at any time.');
  if (dealDisclaimer && !desc.toLowerCase().includes('may change or end at any time')) {
    desc = desc.replace(/\s+$/, '') + ' ' + dealDisclaimer;
  }

  // 3. Collapse duplicate blank lines.
  desc = desc.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  p.pinterestDescription = desc;

  // 4. Hashtags — de-dup and cap at 12.
  const tags    = _splitHashtags(p.hashtags);
  const cleaned = [];
  const seen    = new Set();
  for (const raw of tags) {
    let t = _trim(raw);
    if (!t) continue;
    if (!t.startsWith('#')) t = '#' + t;
    t = t.replace(/[^#A-Za-z0-9_]/g, '');
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(t);
  }
  p.hashtags = cleaned.slice(0, HASHTAG_MAX).join(' ').trim();

  // 5. Suggested board — fall back to template.
  if (!_trim(p.suggestedBoard) && template && template.suggestedBoard) {
    p.suggestedBoard = template.suggestedBoard;
  }

  // 6. Tagged topics — fall back to template.
  if (!_trim(p.taggedTopics) && template && Array.isArray(template.taggedTopics)) {
    p.taggedTopics = template.taggedTopics.join(', ');
  }

  // 7. Alt text — generate via callback if available, else fall back to a
  //    safe templated string built from product title + use cases.
  if (!_trim(p.altText)) {
    let alt = '';
    if (typeof options.altGenerator === 'function') {
      try { alt = _trim(options.altGenerator(p)); } catch { /* ignore */ }
    }
    if (!alt) {
      const product  = _trim(p.productTitle) || _trim(p.pinterestTitle) || 'Amazon product';
      const useCases = (template && Array.isArray(template.useCases) && template.useCases.length)
                        ? template.useCases.slice(0, 3).join(', ')
                        : 'everyday use';
      alt = `${product} for ${useCases}.`.replace(/\s{2,}/g, ' ').trim();
    }
    if (alt.length > 280) alt = alt.substring(0, 277).trim() + '...';
    p.altText = alt;
  }

  // 8. Affiliate — never invent. Leave as-is.

  return p;
}

// ─── Exports (Node + browser globals) ──────────────────────────────────────

const _api = {
  scorePinPackage,
  getQualityWarnings,
  autoFixPinPackage,
  QUALITY_GOOD_THRESHOLD,
  QUALITY_NEEDS_REVIEW_THRESHOLD,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;
}

if (typeof window !== 'undefined') {
  Object.assign(window, _api);
}
