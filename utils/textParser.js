/**
 * utils/textParser.js
 *
 * Phase 2: Pinterest Pin Copy Generator.
 *
 * Parses Facebook post captions for deal info, coupons, product titles,
 * and generates Pinterest-ready titles, descriptions, hashtags, and alt
 * text. All work is local — no network calls, no analytics, no auto-post.
 *
 * Public surface (exposed via window in the extension popup, and via
 * module.exports for Node testing):
 *   - extractProductTitle(caption)
 *   - detectProductCategory(title, caption)
 *   - generatePinterestTitle(productTitle, categoryData)
 *   - generatePinterestDescription({ productTitle, caption, couponCode,
 *       dealType, affiliateUrl, categoryData })
 *   - generateHashtags(categoryData, productTitle)
 *   - generateAltText(productTitle, categoryData, caption)
 *   - extractCouponCode(text)
 *   - extractDealType(text)
 *   - cleanCaption(text)
 *   - parseCaption(rawText, affiliateUrl)
 */

'use strict';

// ─── Caption Cleanup Patterns (Deal Cleanup Engine) ────────────────────────

/**
 * Normalisations applied while cleaning captions or detecting deal types.
 * Order matters — earlier rules run first.
 */
const NORMALIZE_PATTERNS = [
  // Common stylised spellings
  { from: /pr[!1i]ce\s*drop/gi,         to: 'Price Drop' },
  { from: /lightning\s*drop/gi,         to: 'Lightning Drop' },
  { from: /lightning\s*deal/gi,         to: 'Lightning Deal' },
  { from: /\bqpon\b/gi,                 to: 'Coupon' },
  { from: /\+\s*clip\s*✂?\s*coupon/gi,  to: 'Clip Coupon' },

  // "Half off with CODE" → "Half off with code: CODE"
  { from: /half\s*off\s*with\s+([A-Z0-9]{4,20})\b/gi, to: 'Half off with code: $1' },
];

/**
 * Boilerplate / engagement-bait phrases stripped from cleaned captions.
 * Each entry can be a regex or a string (case-insensitive).
 */
const STRIP_PATTERNS = [
  /\[\s*ad\s*\]/gi,
  /(^|\s)#ad\b/gi,
  /\bAD\b/g,
  /don[’']?t forget to comment,?\s*like,?\s*and\/or share!?/gi,
  /please\s+(?:comment|like|share)[^\n]*/gi,
  /comment,?\s*like,?\s*(?:and\/or|and|or)?\s*share[^\n]*/gi,
  /prices?\s*[\/&,]?\s*deals?\s*[\/&,]?\s*(?:codes?|coupons?)?\s*subject to change\s*(?:\/|or)?\s*end at any time\.?/gi,
  /prices?\s*,\s*deals?\s*,\s*(?:and\s*)?coupon\s*codes?\s*may change or end at any time\.?/gi,
  /as an amazon associate,?\s*i earn from qualifying purchases\.?/gi,
  /📎|👇|🔗|⬇️|⬇/g,
];

// Decorative / leading deal-banner phrases stripped from product titles only.
const TITLE_STRIP_PHRASES = [
  /^[\s\-–—|•·,.]+/,                                         // leading punctuation
  /^\[\s*ad\s*\]\s*/i,
  /^#ad\b\s*/i,
  /^ad\b\s*[:\-]?\s*/i,                                      // "AD " or "AD: "
  /^(?:🎉|🔥|⚡|✨|💥|🛒|✅|⭐|💯|👇|🔗|⬇️|⬇)+\s*/u,
  /^\d+\s*%\s*off\s*[:\-–—!]?\s*/i,
  /^half\s*off\s*(?:with\s*(?:code\s*[:\-]?\s*)?[A-Z0-9]{4,20}\s*)?[:\-–—!]?\s*/i,
  /^(?:use|code|coupon|promo)\s*[:\-]?\s*[A-Z0-9]{4,20}\s*[:\-–—!]?\s*/i,
  /^(?:price\s*drop|lightning\s*(?:drop|deal)|prime\s*(?:discount|deal|day)|clip\s*coupon|coupon|deal|sale|hot\s*deal|big\s*deal|huge\s*deal|amazon\s*deal)\s*[:\-–—!]?\s*/i,
  /^\$\d+(?:\.\d+)?\s*[:\-–—!]?\s*/,
  /^free\s*shipping\s*[:\-–—!]?\s*/i,
];

// Category mapping (Phase 2 spec).
//
// `keywords` is matched against title + caption (lower-cased).
// `taggedTopics`, `hashtags`, `useCases` come straight from the spec.
const CATEGORIES = [
  {
    category: 'tech',
    keywords: ['charger', 'usb', 'usb c', 'usb-c', 'bluetooth', 'headphone', 'headphones',
               'earbud', 'earbuds', 'wireless', 'phone', 'cable', 'adapter', 'power bank',
               'power strip', 'speaker', 'tablet', 'laptop', 'monitor', 'keyboard',
               'mouse', 'tech'],
    suggestedBoard: 'Tech Gadgets & Charging Essentials',
    taggedTopics:  ['Tech Gadgets', 'Phone Accessories', 'USB C Charger', 'Fast Charging', 'Amazon Finds'],
    hashtags:      ['#TechEssentials', '#TechGadgets', '#PhoneAccessories', '#FastCharging', '#AmazonTech'],
    useCases:      ['home', 'work', 'travel', 'desk setups', 'everyday devices'],
    seoPhrase:     'Fast Charging Wall Adapter',
  },
  {
    category: 'home-organization',
    keywords: ['organizer', 'storage', 'bins', 'bin', 'caddy', 'declutter', 'closet',
               'shelf', 'shelves', 'file box', 'documents', 'pantry', 'drawer organizer',
               'spice rack', 'basket'],
    suggestedBoard: 'Home Organization & Storage Finds',
    taggedTopics:  ['Home Organization', 'Storage Bins', 'Small Space Living', 'Office Organization', 'Amazon Finds'],
    hashtags:      ['#HomeOrganization', '#StorageSolutions', '#SmallSpaceLiving', '#DeclutterYourHome', '#OrganizedHome'],
    useCases:      ['bedrooms', 'offices', 'dorms', 'closets', 'small spaces', 'living rooms'],
    seoPhrase:     'Space-Saving Home Organizer',
  },
  {
    category: 'kitchen',
    keywords: ['kitchen', 'grinder', 'salt', 'pepper', 'drink maker', 'slushie', 'utensil',
               'cooking', 'bbq', 'air fryer', 'instant pot', 'blender', 'mixer', 'spatula',
               'whisk', 'cutting board', 'knife set', 'measuring cups', 'food storage',
               'tongs', 'colander'],
    suggestedBoard: 'Kitchen Gadgets & Cooking Essentials',
    taggedTopics:  ['Kitchen Gadgets', 'Cooking Essentials', 'Kitchen Tools', 'Home Cooking', 'Amazon Finds'],
    hashtags:      ['#KitchenGadgets', '#CookingEssentials', '#KitchenTools', '#HomeCooking', '#AmazonKitchen'],
    useCases:      ['everyday cooking', 'meal prep', 'BBQ nights', 'parties', 'kitchen counters'],
    seoPhrase:     'Kitchen Gadget for Everyday Cooking',
  },
  // Note: 'eco' is ordered before 'beauty' because products like a "bamboo
  // toothbrush" should map to the eco board, not the beauty board.
  {
    category: 'eco',
    keywords: ['bamboo', 'biodegradable', 'eco', 'eco-friendly', 'sustainable',
               'zero waste', 'reusable', 'compostable', 'plant-based'],
    suggestedBoard: 'Eco-Friendly Home & Self-Care Finds',
    taggedTopics:  ['Eco-Friendly Products', 'Sustainable Living', 'Zero Waste', 'Amazon Finds'],
    hashtags:      ['#EcoFriendlyProducts', '#SustainableLiving', '#ZeroWaste', '#GreenHome', '#AmazonEco'],
    useCases:      ['family routines', 'travel', 'bathroom essentials', 'sustainable living'],
    seoPhrase:     'Eco-Friendly Everyday Essential',
  },
  {
    category: 'beauty',
    keywords: ['concealer', 'lip', 'lip duo', 'lipstick', 'lip gloss', 'makeup', 'beauty',
               'skincare', 'moisturizer', 'serum', 'cleanser', 'mouthwash', 'oral care',
               'toothbrush', 'mascara', 'foundation', 'blush', 'bronzer', 'sunscreen',
               'spf', 'face wash'],
    suggestedBoard: 'Beauty & Self-Care Finds',
    taggedTopics:  ['Beauty', 'Makeup', 'Self Care', 'Oral Care', 'Amazon Finds'],
    hashtags:      ['#BeautyFinds', '#MakeupEssentials', '#SelfCare', '#SkincareRoutine', '#AmazonBeauty'],
    useCases:      ['daily routines', 'travel bags', 'bathroom essentials', 'quick touch-ups'],
    seoPhrase:     'Everyday Self-Care Essential',
  },
  {
    category: 'fashion',
    keywords: ['bag', 'crossbody', 'purse', 'wallet', 'tote', 'handbag', 'slipper',
               'slippers', 'shoe', 'shoes', 'sneaker', 'flip flop', 'flip flops', 'sandal',
               'fashion', 'outfit', 'jewelry', 'necklace', 'bracelet', 'sunglasses',
               'scarf', 'hat'],
    suggestedBoard: 'Amazon Fashion & Bag Finds',
    taggedTopics:  ['Fashion Accessories', 'Crossbody Bag', 'Women\u2019s Fashion', 'Amazon Finds'],
    hashtags:      ['#FashionFinds', '#AmazonFashion', '#WomensFashion', '#CrossbodyBag', '#StyleEssentials'],
    useCases:      ['errands', 'travel', 'everyday outfits', 'home comfort', 'date nights'],
    seoPhrase:     'Stylish Everyday Essential',
  },
  {
    category: 'office',
    keywords: ['office', 'desk', 'chair', 'work', 'study', 'ergonomic', 'monitor stand',
               'desk lamp', 'office chair', 'desk organizer', 'standing desk', 'mouse pad',
               'wfh', 'work from home'],
    suggestedBoard: 'Home Office & Desk Setup Finds',
    taggedTopics:  ['Home Office', 'Desk Setup', 'Work From Home', 'Office Chair', 'Amazon Finds'],
    hashtags:      ['#OfficeSetup', '#HomeOffice', '#DeskSetup', '#WorkFromHome', '#ProductivityTools'],
    useCases:      ['work sessions', 'studying', 'home offices', 'computer desks', 'small workspaces'],
    seoPhrase:     'Home Office Essential',
  },
  {
    category: 'art',
    keywords: ['marker', 'markers', 'art', 'drawing', 'coloring', 'journaling', 'craft',
               'crafts', 'paint', 'paints', 'sketch', 'sketchbook', 'colored pencil',
               'gel pen', 'gel pens', 'planner', 'sticker'],
    suggestedBoard: 'Art Supplies & Creative Finds',
    taggedTopics:  ['Art Supplies', 'Drawing', 'Coloring', 'Journaling', 'Amazon Finds'],
    hashtags:      ['#ArtSupplies', '#DrawingEssentials', '#JournalingFinds', '#CreativeProjects', '#AmazonCrafts'],
    useCases:      ['journaling', 'coloring', 'note-taking', 'crafts', 'creative projects'],
    seoPhrase:     'Creative Art Supply',
  },
];

const DEFAULT_CATEGORY_DATA = {
  category:       'general',
  suggestedBoard: 'Amazon Finds & Daily Deals',
  taggedTopics:   ['Amazon Finds', 'Amazon Must Haves', 'Daily Deals'],
  hashtags:       ['#AmazonMustHaves', '#AmazonDeals', '#DailyFinds', '#AmazonFavorites'],
  useCases:       ['everyday use', 'gifting', 'home', 'work', 'travel'],
  seoPhrase:      'Amazon Find for Everyday Use',
};


const FACEBOOK_METADATA_RE = /\b(author|admin|group expert|all[- ]star contributor|top contributor|contributor|reply|follow|like|comment|share|see more|active now)\b/i;

function sanitizeFacebookCaption(rawText) {
  if (!rawText) return '';
  let text = String(rawText);
  for (const { from, to } of NORMALIZE_PATTERNS) text = text.replace(from, to);
  text = text.replace(/\r/g, '');
  text = text.replace(/\b[A-Za-z0-9]{24,}\b/g, ' ');
  text = text.replace(/\b(?:JdJB5aXMnK\.comDeals)\b/gi, ' ');
  const lines = text.split('\n').map(l => collapseSpaces(l));
  const kept = [];
  for (let line of lines) {
    if (!line) {
      if (kept.length && kept[kept.length-1] !== '') kept.push('');
      continue;
    }
    const low=line.toLowerCase();
    if (FACEBOOK_METADATA_RE.test(low) && !/(amazon|amzn\.to|a\.co|coupon|code|price drop|lightning drop|prime discount|half off|sale|deal|#ad|\[ad\])/i.test(line)) continue;
    line = line.replace(/^.*?(\[ad\]\s+)/i,'$1');
    line = line.replace(/^(?:[a-z0-9._-]+\.com(?:deals?)?)\s*/i,'');
    line = line.replace(/\bqpon\b/gi,'Coupon').replace(/pr[!1i]ce\s*drop/gi,'Price Drop').replace(/lightning\s*drop/gi,'Lightning Drop');
    // Remove compressed alphanumeric junk tokens frequently found in copied
    // Facebook DOM text blobs (e.g. opntresSodu2m909cgc...).
    line = line.split(/\s+/).filter(tok => {
      if (!tok) return false;
      if (/^https?:\/\//i.test(tok)) return true; // always keep links
      const bare = tok.replace(/[^A-Za-z0-9]/g, '');
      if (bare.length < 16) return true;
      const hasLetters = /[A-Za-z]/.test(bare);
      const hasDigits = /\d/.test(bare);
      // Drop long mixed alphanumeric blobs that look like copied DOM noise.
      return !(hasLetters && hasDigits);
    }).join(' ');
    line = collapseSpaces(line);
    if (!line) continue;
    kept.push(line);
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
// ─── Coupon / Deal Detection ───────────────────────────────────────────────

const COUPON_PATTERNS = [
  // "Use: CODE" / "Use code: CODE" / "Use coupon CODE" / "Apply CODE" etc.
  /\b(?:use|apply|clip)\s*(?:code|coupon|promo)?\s*[:\-]?\s*([A-Z0-9]{4,20})\b/gi,
  // "code CODE" / "Coupon CODE" / "Promo: CODE"
  /\b(?:code|coupon|promo)\s*[:\-]?\s*([A-Z0-9]{4,20})\b/gi,
  // "Half off with CODE" / "Half off with code: CODE"
  /\bhalf\s*off\s*with\s+(?:code\s*[:\-]?\s*)?([A-Z0-9]{4,20})\b/gi,
  // "CODE at checkout"
  /\b([A-Z0-9]{5,20})\s+at\s*checkout\b/gi,
];

// Skip codes that are obvious noise (years, plain numbers, common words).
const COUPON_BLOCKLIST = new Set([
  'AMAZON', 'PRIME', 'CHECKOUT', 'CODE', 'USE', 'HTTPS', 'HTTP', 'AMZN',
  'SALE', 'DEAL', 'OFFER', 'COUPON', 'PROMO',
]);

/**
 * Patterns recognised by extractDealType. Each entry returns a normalised
 * label — e.g. "30% Off", "Price Drop", "Lightning Drop".
 */
const DEAL_PATTERNS = [
  { pattern: /(\d{1,2})\s*%\s*off/i,                    label: m => `${m[1]}% Off` },
  { pattern: /pr[!1i]ce\s*drop/i,                       label: () => 'Price Drop' },
  { pattern: /lightning\s*drop/i,                       label: () => 'Lightning Drop' },
  { pattern: /lightning\s*deal/i,                       label: () => 'Lightning Deal' },
  { pattern: /prime\s*(?:discount|deal|day)/i,          label: () => 'Prime Discount' },
  { pattern: /\bclip\s*(?:✂\s*)?(?:coupon|qpon)\b/i,    label: () => 'Clip Coupon' },
  { pattern: /\bqpon\b/i,                               label: () => 'Coupon' },
  { pattern: /half\s*off/i,                             label: () => 'Half Off' },
  { pattern: /\bbogo\b/i,                               label: () => 'BOGO Deal' },
  { pattern: /limited\s*time/i,                         label: () => 'Limited Time Deal' },
  { pattern: /\bsale\b/i,                               label: () => 'Sale' },
  { pattern: /\bdeal\b/i,                               label: () => 'Deal' },
];

// ─── Small Helpers ─────────────────────────────────────────────────────────

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F1E6}-\u{1F1FF}]/gu;

function stripEmojis(text) {
  if (!text) return '';
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function collapseSpaces(text) {
  return (text || '').replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').trim();
}

function titleCaseSlug(text) {
  return (text || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function uniqueAppend(target, item) {
  if (!item) return;
  const exists = target.find(x => x.toLowerCase() === item.toLowerCase());
  if (!exists) target.push(item);
}

function applyTitleStripPhrases(line) {
  let prev;
  let cur  = line;
  // Repeatedly strip leading deal/banner phrases until stable.
  do {
    prev = cur;
    for (const re of TITLE_STRIP_PHRASES) cur = cur.replace(re, '');
    cur = cur.trim();
  } while (cur !== prev);
  return cur;
}

// ─── Coupon / Deal Helpers ─────────────────────────────────────────────────

/**
 * Extract a coupon code from text, returning the first plausible match.
 * @param {string} text
 * @returns {string|null}
 */
function extractCouponCode(text) {
  if (!text) return null;
  for (const pattern of COUPON_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (!match[1]) continue;
      const code = match[1].trim().toUpperCase();
      if (code.length < 4 || code.length > 20) continue;
      if (!/[A-Z]/.test(code))                  continue; // skip pure numbers
      if (COUPON_BLOCKLIST.has(code))           continue;
      return code;
    }
  }
  return null;
}

/**
 * Extract a normalised deal type label, e.g. "30% Off", "Price Drop".
 * @param {string} text
 * @returns {string|null}
 */
function extractDealType(text) {
  if (!text) return null;
  for (const { pattern, label } of DEAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return label(match);
  }
  return null;
}

// ─── Caption Cleanup Engine ────────────────────────────────────────────────

/**
 * Clean a raw Facebook caption for use as a Pinterest description source.
 * Strips disclosure text, engagement bait, links, repeated lines, and
 * decorative emoji while normalising stylised deal phrases.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanCaption(text) {
  if (!text) return '';

  // Apply normalisations first (Pr!ce Drop → Price Drop, etc.).
  let normalised = text;
  for (const { from, to } of NORMALIZE_PATTERNS) {
    normalised = normalised.replace(from, to);
  }

  const lines  = normalised.split('\n').map(l => l.trim());
  const seen   = new Set();
  const result = [];

  for (let line of lines) {
    if (!line) {
      if (result.length > 0 && result[result.length - 1] !== '') result.push('');
      continue;
    }

    // Apply strip patterns.
    for (const re of STRIP_PATTERNS) line = line.replace(re, ' ');

    // Drop standalone Amazon / amzn.to / a.co URLs (Phase 2: don't keep
    // original short links in description; popup will inject the affiliate).
    line = line.replace(/https?:\/\/\S+/gi, ' ');

    // Reduce excessive emoji clusters (3+ in a row → at most one).
    line = line.replace(/([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*){3,}/gu, '');

    line = collapseSpaces(line);
    if (!line) continue;

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }

  // Trim leading/trailing blank lines and collapse 2+ blanks.
  while (result.length && result[0]                === '') result.shift();
  while (result.length && result[result.length - 1] === '') result.pop();

  return result.join('\n');
}

// ─── Product Title Extraction ──────────────────────────────────────────────

/**
 * Extract the first meaningful description sentence (used as a fallback /
 * enrichment source when the title line is weak).
 */
function firstDescriptionSentence(caption) {
  if (!caption) return '';
  const cleaned = cleanCaption(caption);
  const lines   = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  // Skip the first line (treated as title) when looking for the description.
  const body = lines.slice(1).join(' ');
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0] || body;
  return firstSentence.trim();
}

/**
 * Detect "X-pack" / "X pack" / "set of X" patterns to enrich titles.
 */
function detectPackPhrase(text) {
  if (!text) return null;
  const m =
    text.match(/\b(\d+)\s*[- ]?\s*(?:pack|pk|piece|pcs|set)\b/i) ||
    text.match(/\bpack of\s+(\d+)\b/i) ||
    text.match(/\bset of\s+(\d+)\b/i);
  if (m) return `${m[1]}-Pack`;
  return null;
}

/**
 * Stop words we don't want to drag into a product title from the
 * surrounding description.
 */
const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'this', 'these', 'those', 'that',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'with', 'for', 'of', 'to', 'by', 'on', 'in', 'at',
  'pair', 'set', 'cozy', 'super', 'very', 'really', 'cute', 'nice',
  'perfect', 'great', 'amazing', 'best', 'new', 'all', 'every',
]);

function toTitleCase(text) {
  return (text || '').replace(/\b([a-zA-Z])([a-zA-Z]*)/g,
    (_, head, tail) => head.toUpperCase() + tail.toLowerCase());
}

/**
 * If the description contains the candidate as a substring with extra
 * descriptive words right before it (e.g. "memory foam flip flop slippers"
 * containing "flip flop slippers" with "memory foam" as a prefix), return
 * the enriched title. Otherwise return the original candidate.
 */
function enrichTitleFromDescription(candidate, description) {
  if (!candidate || !description) return candidate;
  const cand = candidate.replace(/\s{2,}/g, ' ').trim();
  if (cand.length < 4) return candidate;

  // Build a regex that matches the candidate as whole-words, ignoring case.
  const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  const match = re.exec(description);
  if (!match || match.index === 0) return candidate;

  // Walk backwards up to 3 descriptive words before the candidate. Skip
  // words containing digits (handled separately by detectPackPhrase).
  const before = description.substring(0, match.index).replace(/\s+$/, '');
  const words  = before.split(/\s+/);
  const prefix = [];
  for (let i = words.length - 1; i >= 0 && prefix.length < 3; i--) {
    const raw  = words[i];
    if (/\d/.test(raw)) break;
    const norm = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!norm)                          break;
    if (TITLE_STOP_WORDS.has(norm))     break;
    if (norm.length < 3)                break;
    prefix.unshift(raw.replace(/[^a-zA-Z-]/g, ''));
  }
  if (prefix.length === 0) return candidate;
  return toTitleCase(`${prefix.join(' ')} ${cand}`).replace(/\s{2,}/g, ' ').trim();
}

/**
 * Heuristically extract a clean, SEO-friendly product title.
 *
 * Rules from Phase 2 spec:
 *  - Remove [ad], AD, leading emojis, deal symbols, links.
 *  - Prefer the first meaningful product line.
 *  - If the product line is weak, infer from the first description sentence.
 *  - Keep wording clean.
 *  - Don't include coupon codes.
 *  - Don't include "price drop" / "deal" / "sale" / "lightning drop" unless
 *    they're part of the actual product name.
 *
 * @param {string} caption
 * @returns {string}
 */
function extractProductTitle(caption) {
  if (!caption) return '';

  // Apply normalisations first so the title sees clean words (e.g.
  // "Pr!ce Drop" → "Price Drop", "Qpon" → "Coupon").
  let normalised = caption;
  for (const { from, to } of NORMALIZE_PATTERNS) {
    normalised = normalised.replace(from, to);
  }

  const lines = normalised
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^https?:\/\//i.test(l));

  // 1) Find the first line that looks like a product line.
  let candidate = '';
  for (const raw of lines) {
    let line = applyTitleStripPhrases(raw);
    line = stripEmojis(line);
    line = line.replace(/\s+/g, ' ').trim();
    // Drop leading/trailing dangling punctuation.
    line = line.replace(/^[\-:|•·,\.]+\s*/, '').replace(/\s*[\-:|•·,]+$/, '').trim();
    if (line.length >= 3 && line.length <= 110) {
      candidate = line;
      break;
    }
  }

  if (!candidate) {
    // Fallback to first cleaned line truncated to 70 chars.
    const first = stripEmojis(applyTitleStripPhrases(lines[0] || '')).trim();
    candidate = first.substring(0, 70).trim();
  }

  // Never allow Facebook metadata lines to become product titles.
  if (FACEBOOK_METADATA_RE.test(candidate)) return '';

  // 2) Enrich from the first description sentence:
  //    - Prepend descriptive words from the description if they sit right
  //      before the candidate phrase (e.g. "memory foam flip flop slippers"
  //      → "Memory Foam Flip Flop Slippers").
  //    - Append a pack phrase (e.g. "2-Pack") if found in the description.
  const description = firstDescriptionSentence(caption);
  candidate = enrichTitleFromDescription(candidate, description);

  const pack = detectPackPhrase(description);
  if (pack && !/\b\d+\s*[- ]?\s*(?:pack|pk|piece|pcs|set)\b/i.test(candidate) &&
              !/pack of\s+\d+/i.test(candidate)) {
    candidate = `${candidate} ${pack}`.trim();
  }

  // 3) Strip stray "deal", "sale", "price drop", "lightning drop" unless
  //    they appear to be part of an actual product name (i.e. surrounded by
  //    other product words). We only strip leading occurrences here.
  candidate = candidate
    .replace(/^(?:price\s*drop|lightning\s*(?:drop|deal)|sale|deal)\s*[:\-–—!]?\s*/i, '')
    .trim();

  // 4) Remove any coupon-like ALL-CAPS tokens at the very end (defensive).
  candidate = candidate.replace(/\s+[A-Z0-9]{6,}$/u, '').trim();

  // 5) Collapse whitespace, cap length.
  candidate = candidate.replace(/\s{2,}/g, ' ').trim();
  if (candidate.length > 110) candidate = candidate.substring(0, 110).trim();

  return candidate;
}

// ─── Category Detection ────────────────────────────────────────────────────

/**
 * Detect the product category from the title + caption text.
 *
 * Returns full category data including suggestedBoard, taggedTopics,
 * hashtags, useCases, and seoPhrase.
 *
 * @param {string} title
 * @param {string} caption
 * @returns {{
 *   category: string,
 *   suggestedBoard: string,
 *   taggedTopics: string[],
 *   hashtags: string[],
 *   useCases: string[],
 *   seoPhrase: string,
 * }}
 */
function detectProductCategory(title, caption) {
  const haystack = `${title || ''}\n${caption || ''}`.toLowerCase();
  if (!haystack.trim()) return { ...DEFAULT_CATEGORY_DATA };

  // Word-boundary aware match. Multi-word keywords are checked as
  // substrings since they already contain spaces.
  function keywordMatches(keyword) {
    const k = keyword.toLowerCase();
    if (k.includes(' ') || k.includes('-')) return haystack.includes(k);
    const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(haystack);
  }

  for (const entry of CATEGORIES) {
    if (entry.keywords.some(keywordMatches)) {
      return {
        category:       entry.category,
        suggestedBoard: entry.suggestedBoard,
        taggedTopics:   [...entry.taggedTopics],
        hashtags:       [...entry.hashtags],
        useCases:       [...entry.useCases],
        seoPhrase:      entry.seoPhrase,
      };
    }
  }
  return { ...DEFAULT_CATEGORY_DATA };
}

// ─── Pinterest Title Generator ─────────────────────────────────────────────

/**
 * Build a Pinterest-ready SEO title.
 *
 *   [Product Title] | [Category SEO Phrase]
 *   [Product Title] | Amazon Find for [Main Use Case]
 *
 * Rules:
 *  - Under 100 chars when possible.
 *  - Include the main product keyword.
 *  - No clickbait, no all-caps, minimal emoji.
 *
 * @param {string} productTitle
 * @param {object} categoryData  result of detectProductCategory()
 * @returns {string}
 */
function generatePinterestTitle(productTitle, categoryData) {
  const data = categoryData || DEFAULT_CATEGORY_DATA;
  const title = (productTitle || '').trim() || 'Amazon Find';

  const candidates = [
    `${title} | ${data.seoPhrase}`,
    `${title} | Amazon Find for ${data.useCases?.[0] || 'Everyday Use'}`,
    title,
  ];

  // Pick the shortest candidate that still fits 100 chars; otherwise fall
  // back to the title alone, truncated.
  for (const c of candidates) {
    if (c.length <= 100) return c;
  }
  return title.length > 100 ? title.substring(0, 97).trim() + '...' : title;
}

// ─── Pinterest Description Generator ───────────────────────────────────────

/**
 * Format an array of use cases ("home", "work", ...) into a comma-list with
 * an Oxford "and".
 */
function formatUseCases(useCases) {
  const list = (useCases || []).filter(Boolean);
  if (list.length === 0) return 'everyday use';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

/**
 * Take 2–3 useful sentences from the cleaned caption to use as the body of
 * the Pinterest description.
 *
 * Skips the first cleaned line if it's just the product title (we don't
 * want the description to start by repeating the title), strips leading
 * decorative emojis, and avoids "Use: CODE" lines.
 *
 * Falls back to a generic blurb if the cleaned caption is empty / too
 * short.
 */
function extractDescriptionBody(cleaned, productTitle, categoryData) {
  if (cleaned) {
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);

    // Drop the first line when it's effectively the product title.
    let bodyLines = lines.slice();
    if (bodyLines.length > 1 && productTitle) {
      const firstStripped = stripEmojis(bodyLines[0]).toLowerCase();
      const titleLower    = productTitle.toLowerCase();
      const titleCore     = titleLower.replace(/\b(\d+[- ]?pack|memory foam|stainless steel|fireproof)\b/gi, '').trim();
      if (firstStripped &&
          (firstStripped.includes(titleLower) ||
           titleLower.includes(firstStripped) ||
           (titleCore && firstStripped.includes(titleCore)))) {
        bodyLines = bodyLines.slice(1);
      }
    }

    // Drop lines that look like coupon / promo / use-code instructions —
    // the deal/coupon line is rendered separately further down.
    const isCouponLine = l =>
      /^\s*(?:use|code|coupon|promo|apply|clip)\b[\s:\-]+[A-Z0-9]{4,20}\b/i.test(l) ||
      /^\s*(?:half\s*off\s*with)\b/i.test(l) ||
      /^\s*\d{1,2}\s*%\s*off\b/i.test(l);

    bodyLines = bodyLines.filter(l => !isCouponLine(l));

    const joined = bodyLines.join(' ').replace(/\s{2,}/g, ' ').trim();
    if (joined) {
      const isCouponSentence = s =>
        /^\s*(?:use|code|coupon|promo|apply|clip)\b[\s:\-]*[A-Z0-9]{4,20}\b/i.test(s) ||
        /^\s*half\s*off\s*with\b/i.test(s);

      const sentences = joined
        .split(/(?<=[.!?])\s+/)
        .map(s => stripEmojis(s).trim())
        .filter(s => s.length >= 12)
        .filter(s => !isCouponSentence(s));
      if (sentences.length) {
        const picked = sentences.slice(0, 3).join(' ');
        if (picked.length >= 30) return picked;
      }
    }
  }

  const seo = (categoryData && categoryData.seoPhrase) || DEFAULT_CATEGORY_DATA.seoPhrase;
  const article = /^[aeiouAEIOU]/.test(seo) ? 'an' : 'a';
  return `${productTitle || 'This Amazon find'} is ${article} ${seo.toLowerCase()} that fits naturally into everyday life.`;
}

/**
 * Build the Pinterest description.
 *
 * Format:
 *   [emoji] [2-3 sentence rewritten product description]
 *
 *   Perfect for [use cases].
 *
 *   [deal/code line if detected]
 *   Shop here 👇
 *   [affiliate link]
 *
 *   #ad As an Amazon Associate, I earn from qualifying purchases. Prices,
 *   deals, and coupon codes may change or end at any time.
 *
 * @param {{
 *   productTitle: string,
 *   caption: string,
 *   couponCode?: string|null,
 *   dealType?: string|null,
 *   affiliateUrl?: string,
 *   categoryData?: object,
 * }} data
 * @returns {string}
 */
function generatePinterestDescription(data) {
  const {
    productTitle,
    caption,
    couponCode,
    dealType,
    affiliateUrl,
    categoryData,
  } = data || {};

  const cd       = categoryData || DEFAULT_CATEGORY_DATA;
  const cleaned  = cleanCaption(caption || '');
  const body     = extractDescriptionBody(cleaned, productTitle, cd);
  const useCases = formatUseCases(cd.useCases);

  // Choose a single tasteful emoji prefix per category (no excessive emojis).
  const emojiByCategory = {
    tech:               '⚡',
    'home-organization': '🧺',
    kitchen:             '🍳',
    beauty:              '💄',
    fashion:             '👜',
    office:              '💼',
    art:                 '🎨',
    eco:                 '🌿',
    general:             '✨',
  };
  const emoji = emojiByCategory[cd.category] || '✨';

  let dealLine = '';
  if (couponCode && dealType)      dealLine = `\n\n${dealType} — Use code: ${couponCode}`;
  else if (couponCode)             dealLine = `\n\nUse code: ${couponCode}`;
  else if (dealType)               dealLine = `\n\n${dealType}`;

  const shopLine = affiliateUrl ? `\nShop here 👇\n${affiliateUrl}` : '';
  const disclosure =
    '\n\n#ad As an Amazon Associate, I earn from qualifying purchases. ' +
    'Prices, deals, and coupon codes may change or end at any time.';

  const head = `${emoji} ${body}`.trim();
  return `${head}\n\nPerfect for ${useCases}.${dealLine}${shopLine}${disclosure}`.trim();
}

// ─── Hashtag Generator ─────────────────────────────────────────────────────

/**
 * Build 8–12 relevant hashtags. Always includes #AmazonFinds.
 *
 * @param {object} categoryData
 * @param {string} productTitle
 * @returns {string}
 */
function generateHashtags(categoryData, productTitle) {
  const cd = categoryData || DEFAULT_CATEGORY_DATA;

  const tags = [];
  uniqueAppend(tags, '#AmazonFinds');
  uniqueAppend(tags, '#AmazonMustHaves');
  for (const t of cd.hashtags || []) uniqueAppend(tags, t);

  // Add a title-derived hashtag (CamelCase, max 1 to avoid spam).
  if (productTitle) {
    const slug = titleCaseSlug(productTitle);
    if (slug.length >= 4 && slug.length <= 30) {
      uniqueAppend(tags, `#${slug}`);
    }
  }

  // Top-up with a couple of generic but relevant tags.
  const topUps = ['#AmazonDeals', '#DailyFinds', '#AmazonFavorites'];
  for (const t of topUps) {
    if (tags.length >= 12) break;
    uniqueAppend(tags, t);
  }

  // Sanitize: no spaces inside hashtags, no duplicates, max 12.
  const cleaned = tags
    .map(t => t.replace(/\s+/g, ''))
    .filter(t => /^#[A-Za-z0-9]+$/.test(t));

  // Ensure 8–12 range. If for some reason we have fewer than 8, pad with
  // safe generic tags.
  const fillers = ['#AmazonShop', '#OnlineShopping', '#GiftIdeas', '#ShopSmall'];
  for (const f of fillers) {
    if (cleaned.length >= 8) break;
    if (!cleaned.includes(f)) cleaned.push(f);
  }

  return cleaned.slice(0, 12).join(' ');
}

// ─── Alt Text Generator ────────────────────────────────────────────────────

/**
 * Build descriptive alt text for the Pinterest image.
 *
 * Rules:
 *  - Clear and descriptive.
 *  - No hashtags, disclosure, or salesy discount language.
 *  - Mention product + use cases.
 *
 * @param {string} productTitle
 * @param {object} categoryData
 * @param {string} caption
 * @returns {string}
 */
function generateAltText(productTitle, categoryData, caption) {
  const cd = categoryData || DEFAULT_CATEGORY_DATA;
  const product = (productTitle || '').trim() || 'Amazon product';
  const useCases = formatUseCases(cd.useCases);

  // Try to mine a short descriptor (e.g. "with dual ports") from the
  // cleaned caption for extra colour. Optional — kept short.
  const cleaned = cleanCaption(caption || '');
  let descriptor = '';
  const m = cleaned.match(/\b(with|featuring|that has|including)\s+([^.\n]{6,80}?)(?=[.\n]|$)/i);
  if (m) descriptor = ` with ${m[2].trim().replace(/\s{2,}/g, ' ')}`;

  let alt = `${product}${descriptor} for ${useCases}.`;
  alt = alt.replace(/\s{2,}/g, ' ').trim();
  if (alt.length > 280) alt = alt.substring(0, 277).trim() + '...';
  return alt;
}

// ─── Full Parse Pipeline ───────────────────────────────────────────────────

/**
 * Run the full Phase 2 parse pipeline.
 *
 * @param {string} rawText       Raw Facebook caption.
 * @param {string} affiliateUrl  Already-converted Amazon affiliate URL.
 * @returns {{
 *   productTitle: string,
 *   cleanedCaption: string,
 *   couponCode: string|null,
 *   dealType: string|null,
 *   category: string,
 *   board: string,
 *   suggestedBoard: string,
 *   taggedTopics: string[],
 *   useCases: string[],
 *   seoPhrase: string,
 *   pinterestTitle: string,
 *   pinterestDescription: string,
 *   hashtags: string,
 *   altText: string,
 * }}
 */
function parseCaption(rawText, affiliateUrl) {
  const cleanedCaption = sanitizeFacebookCaption(rawText);
  const productTitle   = extractProductTitle(cleanedCaption);
  const couponCode     = extractCouponCode(cleanedCaption);
  const dealType       = extractDealType(cleanedCaption);
  const categoryData   = detectProductCategory(productTitle, cleanedCaption);

  const pinterestTitle       = generatePinterestTitle(productTitle, categoryData);
  const pinterestDescription = generatePinterestDescription({
    productTitle,
    caption: cleanedCaption,
    couponCode,
    dealType,
    affiliateUrl,
    categoryData,
  });
  const hashtags = generateHashtags(categoryData, productTitle);
  const altText  = generateAltText(productTitle, categoryData, cleanedCaption);

  return {
    productTitle,
    cleanedCaption,
    couponCode,
    dealType,
    category:       categoryData.category,
    board:          categoryData.suggestedBoard, // legacy alias
    suggestedBoard: categoryData.suggestedBoard,
    taggedTopics:   categoryData.taggedTopics,
    useCases:       categoryData.useCases,
    seoPhrase:      categoryData.seoPhrase,
    pinterestTitle,
    pinterestDescription,
    hashtags,
    altText,
  };
}

// ─── Backwards-compat shim (Phase 1 callers) ───────────────────────────────

/**
 * @deprecated  Kept so any older code still resolves the symbol.
 * Internally delegates to detectProductCategory.
 */
function detectCategory(text) {
  const cd = detectProductCategory('', text || '');
  return { category: cd.category, board: cd.suggestedBoard, hashtags: cd.hashtags };
}

// ─── Exports ───────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractProductTitle,
    extractCouponCode,
    extractDealType,
    cleanCaption,
    sanitizeFacebookCaption,
    detectProductCategory,
    detectCategory, // legacy
    generatePinterestTitle,
    generatePinterestDescription,
    generateHashtags,
    generateAltText,
    parseCaption,
  };
}
