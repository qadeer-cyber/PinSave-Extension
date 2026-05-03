/**
 * utils/templates.js — Phase 4 Pin Templates.
 *
 * Provides per-category Pinterest pin templates that the popup, options
 * page, and queue dashboard can read/write. Templates are stored locally
 * in chrome.storage.local under `pinTemplates`. Defaults are returned for
 * any category that the user has not explicitly customised.
 *
 * No network calls. No analytics. All data stays on-device.
 *
 * Public surface (browser globals + Node module exports):
 *   - getDefaultTemplates()
 *   - getSavedTemplates()
 *   - saveTemplates(templates)
 *   - resetTemplates()
 *   - getTemplateForCategory(category, templates?)
 *   - applyTemplateToPin(pinData, template)
 *   - TEMPLATE_CATEGORIES
 *   - DEFAULT_DISCLOSURE
 *   - DEFAULT_DEAL_DISCLAIMER
 */

'use strict';

const TEMPLATES_STORAGE_KEY = 'pinTemplates';

const DEFAULT_DISCLOSURE      = '#ad As an Amazon Associate, I earn from qualifying purchases.';
const DEFAULT_DEAL_DISCLAIMER = 'Prices, deals, and coupon codes may change or end at any time.';

// Categories the editor surfaces. Order matters for the Options UI.
const TEMPLATE_CATEGORIES = [
  'tech',
  'home-organization',
  'kitchen',
  'beauty',
  'fashion',
  'office',
  'art',
  'eco',
  'default',
];

// ─── Default templates ─────────────────────────────────────────────────────

/**
 * Return a fresh deep copy of the built-in default templates keyed by
 * category. Always returns a new object so callers can mutate freely.
 */
function getDefaultTemplates() {
  const defaults = {
    'tech': {
      category:                'tech',
      titleFormat:             '{productTitle} | Fast Charging Wall Adapter',
      suggestedBoard:          'Tech Gadgets & Charging Essentials',
      taggedTopics:            ['Tech Gadgets', 'Phone Accessories', 'USB C Charger', 'Fast Charging', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#TechEssentials', '#TechGadgets', '#PhoneAccessories', '#FastCharging', '#AmazonTech', '#AmazonMustHaves'],
      descriptionIntroStyle:   '⚡ Reliable everyday tech that just works.',
      useCases:                ['home', 'work', 'travel', 'desk setups', 'everyday devices'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'home-organization': {
      category:                'home-organization',
      titleFormat:             '{productTitle} | Space-Saving Home Organizer',
      suggestedBoard:          'Home Organization & Storage Finds',
      taggedTopics:            ['Home Organization', 'Storage Bins', 'Small Space Living', 'Office Organization', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#HomeOrganization', '#StorageSolutions', '#SmallSpaceLiving', '#DeclutterYourHome', '#OrganizedHome', '#AmazonMustHaves'],
      descriptionIntroStyle:   '🧺 Finally a place for everything.',
      useCases:                ['bedrooms', 'offices', 'dorms', 'closets', 'small spaces', 'living rooms'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'kitchen': {
      category:                'kitchen',
      titleFormat:             '{productTitle} | Kitchen Gadget for Everyday Cooking',
      suggestedBoard:          'Kitchen Gadgets & Cooking Essentials',
      taggedTopics:            ['Kitchen Gadgets', 'Cooking Essentials', 'Kitchen Tools', 'Home Cooking', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#KitchenGadgets', '#CookingEssentials', '#KitchenTools', '#HomeCooking', '#AmazonKitchen', '#AmazonMustHaves'],
      descriptionIntroStyle:   '🍳 A small upgrade that makes everyday cooking easier.',
      useCases:                ['everyday cooking', 'meal prep', 'BBQ nights', 'parties', 'kitchen counters'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'beauty': {
      category:                'beauty',
      titleFormat:             '{productTitle} | Everyday Self-Care Essential',
      suggestedBoard:          'Beauty & Self-Care Finds',
      taggedTopics:            ['Beauty', 'Makeup', 'Self Care', 'Oral Care', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#BeautyFinds', '#MakeupEssentials', '#SelfCare', '#SkincareRoutine', '#AmazonBeauty', '#AmazonMustHaves'],
      descriptionIntroStyle:   '💄 A tiny self-care upgrade that fits any routine.',
      useCases:                ['daily routines', 'travel bags', 'bathroom essentials', 'quick touch-ups'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'fashion': {
      category:                'fashion',
      titleFormat:             '{productTitle} | Stylish Everyday Essential',
      suggestedBoard:          'Amazon Fashion & Bag Finds',
      taggedTopics:            ['Fashion Accessories', 'Crossbody Bag', 'Women\u2019s Fashion', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#FashionFinds', '#AmazonFashion', '#WomensFashion', '#CrossbodyBag', '#StyleEssentials', '#AmazonMustHaves'],
      descriptionIntroStyle:   '👜 An easy add to your everyday rotation.',
      useCases:                ['errands', 'travel', 'everyday outfits', 'home comfort', 'date nights'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'office': {
      category:                'office',
      titleFormat:             '{productTitle} | Home Office Essential',
      suggestedBoard:          'Home Office & Desk Setup Finds',
      taggedTopics:            ['Home Office', 'Desk Setup', 'Work From Home', 'Office Chair', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#OfficeSetup', '#HomeOffice', '#DeskSetup', '#WorkFromHome', '#ProductivityTools', '#AmazonMustHaves'],
      descriptionIntroStyle:   '💼 A small win for your work-from-home setup.',
      useCases:                ['work sessions', 'studying', 'home offices', 'computer desks', 'small workspaces'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'art': {
      category:                'art',
      titleFormat:             '{productTitle} | Creative Art Supply',
      suggestedBoard:          'Art Supplies & Creative Finds',
      taggedTopics:            ['Art Supplies', 'Drawing', 'Coloring', 'Journaling', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#ArtSupplies', '#DrawingEssentials', '#JournalingFinds', '#CreativeProjects', '#AmazonCrafts', '#AmazonMustHaves'],
      descriptionIntroStyle:   '🎨 A creative supply worth keeping on your desk.',
      useCases:                ['journaling', 'coloring', 'note-taking', 'crafts', 'creative projects'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'eco': {
      category:                'eco',
      titleFormat:             '{productTitle} | Eco-Friendly Everyday Essential',
      suggestedBoard:          'Eco-Friendly Home & Self-Care Finds',
      taggedTopics:            ['Eco-Friendly Products', 'Sustainable Living', 'Zero Waste', 'Amazon Finds'],
      hashtags:                ['#AmazonFinds', '#EcoFriendlyProducts', '#SustainableLiving', '#ZeroWaste', '#GreenHome', '#AmazonEco', '#AmazonMustHaves'],
      descriptionIntroStyle:   '🌿 A small swap toward more sustainable everyday living.',
      useCases:                ['family routines', 'travel', 'bathroom essentials', 'sustainable living'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },

    'default': {
      category:                'default',
      titleFormat:             '{productTitle} | Amazon Find for Everyday Use',
      suggestedBoard:          'Amazon Finds & Daily Deals',
      taggedTopics:            ['Amazon Finds', 'Amazon Must Haves', 'Daily Deals'],
      hashtags:                ['#AmazonFinds', '#AmazonMustHaves', '#AmazonDeals', '#DailyFinds', '#AmazonFavorites', '#AmazonShop', '#OnlineShopping'],
      descriptionIntroStyle:   '✨ A useful Amazon find for everyday life.',
      useCases:                ['everyday use', 'gifting', 'home', 'work', 'travel'],
      disclosureText:          DEFAULT_DISCLOSURE,
      dealDisclaimer:          DEFAULT_DEAL_DISCLAIMER,
    },
  };

  // Deep clone so callers can safely mutate.
  return JSON.parse(JSON.stringify(defaults));
}

// ─── Storage helpers ───────────────────────────────────────────────────────

function _hasStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

/**
 * Load templates merged with the built-in defaults. Any user override is
 * returned as a complete template object (defaults filled in for missing
 * fields). Always returns a complete map for every category in
 * TEMPLATE_CATEGORIES.
 */
async function getSavedTemplates() {
  const defaults = getDefaultTemplates();
  if (!_hasStorage()) return defaults;

  const raw = await chrome.storage.local.get([TEMPLATES_STORAGE_KEY]);
  const saved = raw[TEMPLATES_STORAGE_KEY];
  if (!saved || typeof saved !== 'object') return defaults;

  const merged = {};
  for (const cat of TEMPLATE_CATEGORIES) {
    const base   = defaults[cat] || defaults['default'];
    const userT  = saved[cat] && typeof saved[cat] === 'object' ? saved[cat] : {};
    merged[cat] = {
      category:              cat,
      titleFormat:           typeof userT.titleFormat === 'string'           ? userT.titleFormat           : base.titleFormat,
      suggestedBoard:        typeof userT.suggestedBoard === 'string'        ? userT.suggestedBoard        : base.suggestedBoard,
      taggedTopics:          Array.isArray(userT.taggedTopics)               ? userT.taggedTopics.slice()  : base.taggedTopics.slice(),
      hashtags:              Array.isArray(userT.hashtags)                   ? userT.hashtags.slice()      : base.hashtags.slice(),
      descriptionIntroStyle: typeof userT.descriptionIntroStyle === 'string' ? userT.descriptionIntroStyle : base.descriptionIntroStyle,
      useCases:              Array.isArray(userT.useCases)                   ? userT.useCases.slice()      : base.useCases.slice(),
      disclosureText:        typeof userT.disclosureText === 'string' && userT.disclosureText.trim()
                              ? userT.disclosureText
                              : base.disclosureText,
      dealDisclaimer:        typeof userT.dealDisclaimer === 'string' && userT.dealDisclaimer.trim()
                              ? userT.dealDisclaimer
                              : base.dealDisclaimer,
    };
  }
  return merged;
}

/**
 * Persist a templates map. Validates shape and merges with defaults so
 * nothing is silently lost. Returns the saved map.
 */
async function saveTemplates(templates) {
  const defaults = getDefaultTemplates();
  const out = {};

  for (const cat of TEMPLATE_CATEGORIES) {
    const base   = defaults[cat] || defaults['default'];
    const userT  = (templates && typeof templates === 'object' && templates[cat]) || {};
    out[cat] = {
      category:              cat,
      titleFormat:           typeof userT.titleFormat === 'string' && userT.titleFormat.trim()
                              ? userT.titleFormat
                              : base.titleFormat,
      suggestedBoard:        typeof userT.suggestedBoard === 'string' && userT.suggestedBoard.trim()
                              ? userT.suggestedBoard
                              : base.suggestedBoard,
      taggedTopics:          _normaliseList(userT.taggedTopics, base.taggedTopics),
      hashtags:              _normaliseHashtags(userT.hashtags, base.hashtags),
      descriptionIntroStyle: typeof userT.descriptionIntroStyle === 'string'
                              ? userT.descriptionIntroStyle
                              : base.descriptionIntroStyle,
      useCases:              _normaliseList(userT.useCases, base.useCases),
      disclosureText:        typeof userT.disclosureText === 'string' && userT.disclosureText.trim()
                              ? userT.disclosureText
                              : base.disclosureText,
      dealDisclaimer:        typeof userT.dealDisclaimer === 'string' && userT.dealDisclaimer.trim()
                              ? userT.dealDisclaimer
                              : base.dealDisclaimer,
    };
  }

  if (_hasStorage()) {
    await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: out });
  }
  return out;
}

/**
 * Wipe saved templates. Future getSavedTemplates() calls return defaults.
 */
async function resetTemplates() {
  if (_hasStorage()) {
    await chrome.storage.local.remove([TEMPLATES_STORAGE_KEY]);
  }
  return getDefaultTemplates();
}

/**
 * Pick the template that best matches a given category string. Falls back
 * to the 'default' template when category is missing or unknown.
 */
function getTemplateForCategory(category, templates) {
  const map = templates && typeof templates === 'object' ? templates : getDefaultTemplates();
  const key = (category || '').toString().toLowerCase().trim();

  if (key && map[key]) return map[key];

  // A few legacy aliases used elsewhere in the extension.
  if (key === 'general' || key === 'other' || key === '')      return map['default'];
  if (key === 'self-care' || key === 'self care')              return map['beauty'];
  if (key === 'home' || key === 'home organization')           return map['home-organization'];

  return map['default'];
}

/**
 * Apply a template's defaults to a pin payload — only filling in missing
 * fields, never overwriting non-empty user-edited values. Returns a new
 * object; does not mutate the input.
 */
function applyTemplateToPin(pinData, template) {
  const t = template || getDefaultTemplates()['default'];
  const p = pinData && typeof pinData === 'object' ? { ...pinData } : {};

  if (!p.suggestedBoard || !p.suggestedBoard.toString().trim()) {
    p.suggestedBoard = t.suggestedBoard || '';
  }

  if (!p.taggedTopics || !p.taggedTopics.toString().trim()) {
    p.taggedTopics = (t.taggedTopics || []).join(', ');
  }

  // Only seed hashtags if there are none at all. We don't want to drown
  // out the existing parser's hashtag list.
  const existingHashtags = (p.hashtags || '').toString().trim();
  if (!existingHashtags) {
    p.hashtags = (t.hashtags || []).join(' ').trim();
  }

  // Description: ensure disclosure + deal disclaimer are present somewhere,
  // but never mutate the body itself here. The full autofix lives in
  // utils/quality.js.
  return p;
}

// ─── Internal normalisers ──────────────────────────────────────────────────

/**
 * Normalise an inbound list (array or comma-separated string) into a clean
 * trimmed array of strings. Falls back to the supplied default list when
 * the input is empty.
 */
function _normaliseList(value, fallback) {
  let arr;
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(/[,\n]/);
  } else {
    arr = null;
  }
  if (!arr) return (fallback || []).slice();

  const cleaned = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = (raw == null ? '' : String(raw)).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(s);
  }
  return cleaned.length ? cleaned : (fallback || []).slice();
}

/**
 * Normalise hashtags. Accepts either an array or a string. Strips
 * whitespace, ensures every tag starts with `#`, removes duplicates, drops
 * obviously invalid characters. Falls back to defaults when empty.
 */
function _normaliseHashtags(value, fallback) {
  let arr;
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(/[\s,]+/);
  } else {
    arr = null;
  }
  if (!arr) return (fallback || []).slice();

  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    let s = (raw == null ? '' : String(raw)).trim();
    if (!s) continue;
    if (!s.startsWith('#')) s = '#' + s;
    s = s.replace(/[^#A-Za-z0-9_]/g, '');
    if (s.length < 2) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.length ? out : (fallback || []).slice();
}

// ─── Exports (Node + browser globals) ──────────────────────────────────────

const _api = {
  TEMPLATES_STORAGE_KEY,
  TEMPLATE_CATEGORIES,
  DEFAULT_DISCLOSURE,
  DEFAULT_DEAL_DISCLAIMER,
  getDefaultTemplates,
  getSavedTemplates,
  saveTemplates,
  resetTemplates,
  getTemplateForCategory,
  applyTemplateToPin,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _api;
}

if (typeof window !== 'undefined') {
  Object.assign(window, _api);
}
