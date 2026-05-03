/**
 * utils/textParser.js
 * Parses Facebook post captions for deal info, coupons, product titles,
 * and generates Pinterest-ready titles, descriptions, hashtags, and alt text.
 */

// ─── Coupon / Deal Patterns ────────────────────────────────────────────────

const COUPON_PATTERNS = [
  /(?:use|code|coupon|promo|apply|clip)[\s:]+([A-Z0-9]{4,20})/gi,
  /([A-Z0-9]{4,20})\s+(?:at checkout|for discount)/gi,
  /half off\s+(?:with|using)\s+([A-Z0-9]{4,20})/gi,
  // "Use: CODE" or "Use CODE" 
  /\buse\b[\s:]+([A-Z0-9]{5,20})\b/gi,
  // "code CODE"
  /\bcode\b[\s:]+([A-Z0-9]{5,20})\b/gi,
];

const DEAL_KEYWORDS = [
  { pattern: /(\d+)\s*%\s*off/i, label: '$1% Off' },
  { pattern: /price\s*drop/i, label: 'Price Drop' },
  { pattern: /lightning\s*(?:deal|drop)/i, label: 'Lightning Deal' },
  { pattern: /prime\s*(?:discount|deal|day)/i, label: 'Prime Discount' },
  { pattern: /clip\s*coupon/i, label: 'Clip Coupon' },
  { pattern: /\bqpon\b/i, label: 'Coupon Available' },
  { pattern: /half\s*off/i, label: '50% Off' },
  { pattern: /\bsale\b/i, label: 'Sale' },
  { pattern: /\bdeal\b/i, label: 'Deal' },
  { pattern: /\blimited\s*time\b/i, label: 'Limited Time Offer' },
  { pattern: /\bfree\s*shipping\b/i, label: 'Free Shipping' },
  { pattern: /\bbest\s*price\b/i, label: 'Best Price' },
];

// ─── Category / Hashtag Maps ───────────────────────────────────────────────

const CATEGORY_MAP = [
  { keywords: ['charger', 'cable', 'usb', 'power bank', 'battery', 'wireless charger', 'adapter', 'hub', 'laptop', 'phone', 'tablet', 'headphone', 'earbuds', 'speaker', 'bluetooth', 'tech', 'gadget', 'monitor', 'keyboard', 'mouse'], category: 'tech', board: 'Tech Gadgets & Charging Essentials', hashtags: ['#TechGadgets', '#AmazonTech', '#ChargingEssentials', '#SmartHome', '#TechFinds'] },
  { keywords: ['kitchen', 'cook', 'bake', 'pan', 'pot', 'knife', 'cutting board', 'blender', 'air fryer', 'instant pot', 'spatula', 'utensil', 'grinder', 'grater', 'peeler', 'strainer', 'colander', 'toaster', 'coffee', 'espresso', 'mug', 'plate', 'bowl', 'wrap', 'seal', 'food'], category: 'kitchen', board: 'Kitchen Gadgets & Cooking Essentials', hashtags: ['#KitchenGadgets', '#CookingEssentials', '#AmazonKitchen', '#MealPrep', '#HomeChef'] },
  { keywords: ['organizer', 'storage', 'shelf', 'drawer', 'closet', 'bin', 'basket', 'rack', 'hanger', 'container', 'box', 'bag', 'vacuum bag', 'home organization', 'declutter', 'pantry', 'spice rack'], category: 'home-organization', board: 'Home Organization & Storage Finds', hashtags: ['#HomeOrganization', '#StorageSolutions', '#ClutterFree', '#OrganizeYourHome', '#TidyHome'] },
  { keywords: ['serum', 'moisturizer', 'cleanser', 'toner', 'face wash', 'mask', 'sunscreen', 'spf', 'lip', 'concealer', 'foundation', 'mascara', 'eyeliner', 'eyeshadow', 'blush', 'bronzer', 'beauty', 'skincare', 'hair', 'shampoo', 'conditioner', 'body wash', 'lotion', 'perfume', 'nail'], category: 'beauty', board: 'Beauty & Self-Care Finds', hashtags: ['#BeautyFinds', '#SkincareFavorites', '#AmazonBeauty', '#GlowUp', '#SelfCareEssentials'] },
  { keywords: ['shoe', 'sneaker', 'boot', 'sandal', 'slipper', 'flip flop', 'heel', 'flat', 'loafer', 'dress', 'top', 'shirt', 'blouse', 'jacket', 'coat', 'sweater', 'cardigan', 'pants', 'jeans', 'shorts', 'skirt', 'legging', 'activewear', 'swimsuit', 'bag', 'purse', 'wallet', 'belt', 'jewelry', 'watch', 'sunglasses', 'hat', 'scarf', 'gloves', 'fashion', 'clothes', 'outfit'], category: 'fashion', board: 'Amazon Fashion & Bag Finds', hashtags: ['#AmazonFashion', '#FashionFinds', '#OOTDAmazon', '#StyleOnABudget', '#AmazonStyle'] },
  { keywords: ['desk', 'chair', 'monitor stand', 'office', 'pen', 'notebook', 'planner', 'sticky note', 'stapler', 'lamp', 'file', 'folder', 'whiteboard', 'printer', 'ink', 'work from home', 'wfh'], category: 'office', board: 'Home Office & Desk Setup Finds', hashtags: ['#HomeOffice', '#DeskSetup', '#WorkFromHome', '#OfficeOrganization', '#ProductivityTools'] },
  { keywords: ['yoga', 'mat', 'dumbbell', 'resistance band', 'gym', 'fitness', 'workout', 'exercise', 'water bottle', 'protein', 'supplement', 'health', 'wellness', 'massage', 'foam roller'], category: 'fitness', board: 'Fitness & Wellness Essentials', hashtags: ['#FitnessFinds', '#HomeWorkout', '#WellnessEssentials', '#AmazonFitness', '#HealthyLiving'] },
  { keywords: ['paint', 'brush', 'canvas', 'craft', 'art', 'crochet', 'knit', 'sew', 'fabric', 'bead', 'clay', 'diy', 'scrapbook', 'marker', 'colored pencil'], category: 'art', board: 'Art Supplies & Creative Finds', hashtags: ['#ArtSupplies', '#CraftyFinds', '#DIYCreations', '#ArtAndCraft', '#CreativeLiving'] },
  { keywords: ['reusable', 'eco', 'sustainable', 'bamboo', 'organic', 'zero waste', 'compostable', 'natural', 'plant-based', 'biodegradable'], category: 'eco', board: 'Eco-Friendly Home & Self-Care Finds', hashtags: ['#EcoFriendly', '#SustainableLiving', '#ZeroWaste', '#GreenLiving', '#EcoFinds'] },
  { keywords: ['toy', 'game', 'puzzle', 'board game', 'lego', 'doll', 'action figure', 'kids', 'children', 'baby', 'toddler', 'educational'], category: 'kids', board: 'Kids Toys & Educational Finds', hashtags: ['#KidsToys', '#EducationalToys', '#AmazonKids', '#ToddlerActivities', '#FunForKids'] },
  { keywords: ['pet', 'dog', 'cat', 'bird', 'fish', 'collar', 'leash', 'bed', 'bowl', 'treat', 'toy', 'litter', 'grooming'], category: 'pet', board: 'Pet Essentials & Accessories', hashtags: ['#PetFinds', '#DogEssentials', '#CatFinds', '#AmazonPets', '#PetAccessories'] },
];

const DEFAULT_HASHTAGS = ['#AmazonFinds', '#AmazonMustHaves', '#AmazonDeals', '#ad'];

// ─── Extraction Functions ──────────────────────────────────────────────────

/**
 * Extract a coupon code from text. Returns the first match found.
 * @param {string} text
 * @returns {string|null}
 */
function extractCouponCode(text) {
  if (!text) return null;
  for (const pattern of COUPON_PATTERNS) {
    pattern.lastIndex = 0; // reset for global regex
    const match = pattern.exec(text);
    if (match && match[1]) {
      const code = match[1].trim().toUpperCase();
      // Must be 4–20 chars and at least partially alphabetic (avoid matching prices like "10OFF" → keep, or "2024" → skip)
      if (code.length >= 4 && code.length <= 20 && /[A-Z]/.test(code)) {
        return code;
      }
    }
  }
  return null;
}

/**
 * Extract deal type description from text.
 * @param {string} text
 * @returns {string|null}
 */
function extractDealType(text) {
  if (!text) return null;
  for (const { pattern, label } of DEAL_KEYWORDS) {
    const match = text.match(pattern);
    if (match) {
      return label.replace('$1', match[1] || '');
    }
  }
  return null;
}

/**
 * Detect product category from text.
 * @param {string} text
 * @returns {{ category: string, board: string, hashtags: string[] }}
 */
function detectCategory(text) {
  if (!text) return { category: 'general', board: 'Amazon Finds', hashtags: [] };
  const lower = text.toLowerCase();
  for (const entry of CATEGORY_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      return { category: entry.category, board: entry.board, hashtags: entry.hashtags };
    }
  }
  return { category: 'general', board: 'Amazon Finds & Daily Essentials', hashtags: [] };
}

/**
 * Remove emojis and clean up whitespace in text.
 * Keeps alphanumeric, punctuation, and common symbols.
 * @param {string} text
 * @returns {string}
 */
function removeEmojis(text) {
  // Remove emoji ranges
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, '').trim();
}

/**
 * Extract likely product title from caption.
 * Heuristics:
 *  1. First line after [ad] marker if present.
 *  2. First non-empty, non-URL line that is reasonably short (< 80 chars).
 *  3. Fallback: first 60 chars of cleaned text.
 * @param {string} text
 * @returns {string}
 */
function extractProductTitle(text) {
  if (!text) return '';

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // Remove [ad], #ad markers and URLs from consideration for title
  const cleanLines = lines
    .map(l => l.replace(/^\[ad\]|^#ad\b/gi, '').trim())
    .filter(l => l && !l.match(/^https?:\/\//));

  // Find first short-ish line that looks like a product name (title case or emoji start)
  for (const line of cleanLines) {
    const noEmoji = removeEmojis(line).trim();
    if (noEmoji.length >= 5 && noEmoji.length <= 100) {
      return noEmoji;
    }
  }

  // Fallback: first 70 chars of first clean line
  return removeEmojis(cleanLines[0] || '').substring(0, 70);
}

/**
 * Clean a raw Facebook caption:
 * - Remove duplicate lines
 * - Remove bare URLs
 * - Remove excessive blank lines
 * - Preserve coupon lines
 * @param {string} text
 * @returns {string}
 */
function cleanCaption(text) {
  if (!text) return '';

  const lines = text.split('\n').map(l => l.trim());
  const seen = new Set();
  const result = [];

  for (let line of lines) {
    if (!line) {
      if (result.length > 0 && result[result.length - 1] !== '') result.push('');
      continue;
    }

    // Remove common affiliate/post boilerplate that hurts Pinterest descriptions.
    line = line
      .replace(/\[ad\]/gi, '')
      .replace(/\bAD\b/g, '')
      .replace(/#ad\b/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/📎|👇|🔗|⬇️|⬇|\+\s*Clip\s*✂️\s*Qpon/gi, '')
      .replace(/prices\/deals\/codes subject to change\/end at any time\.?/gi, '')
      .replace(/don[’']?t forget to comment,? like,? and\/or share!?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!line) continue;

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }

  while (result.length && result[result.length - 1] === '') result.pop();
  return result.join('\n');
}
// ─── Pinterest Content Generators ─────────────────────────────────────────

/**
 * Generate an SEO-optimised Pinterest title.
 * @param {string} productTitle
 * @param {string} category
 * @returns {string}
 */
function generatePinterestTitle(productTitle, category) {
  if (!productTitle) return 'Amazon Find | Great Deal';

  const suffixMap = {
    kitchen:          'Kitchen Gadget for Everyday Cooking',
    tech:             'Smart Tech Essential',
    'home-organization': 'Home Organization Find',
    beauty:           'Beauty & Self-Care Essential',
    fashion:          'Fashion Find Worth Trying',
    office:           'Home Office Essential',
    fitness:          'Fitness & Wellness Essential',
    art:              'Creative & Craft Essential',
    eco:              'Eco-Friendly Find',
    kids:             'Kids\' Favorite Find',
    pet:              'Must-Have Pet Essential',
    general:          'Amazon Find You\'ll Love',
  };

  const suffix = suffixMap[category] || 'Amazon Must-Have';
  const title = productTitle.length > 50 ? productTitle.substring(0, 50).trim() : productTitle;
  return `${title} | ${suffix}`;
}

/**
 * Generate Pinterest pin description.
 * @param {{ productTitle: string, cleanedCaption: string, couponCode: string|null, dealType: string|null, affiliateUrl: string, category: string }} data
 * @returns {string}
 */
function generatePinterestDescription(data) {
  const { productTitle, cleanedCaption, couponCode, dealType, affiliateUrl, category } = data;

  const categoryUseCases = {
    kitchen: 'everyday cooking, meal prep, family dinners, and kitchen organization',
    tech: 'home, work, travel, charging setups, and everyday devices',
    'home-organization': 'living rooms, bedrooms, closets, dorm rooms, offices, and small spaces',
    beauty: 'daily beauty routines, self-care, travel makeup bags, and quick touch-ups',
    fashion: 'everyday outfits, errands, travel, date nights, and casual style',
    office: 'home offices, studying, desk setups, and long work sessions',
    fitness: 'home workouts, wellness routines, and staying active',
    art: 'drawing, coloring, journaling, crafts, planners, and creative projects',
    eco: 'eco-friendly routines, sustainable living, family use, and travel',
    general: 'daily life, home use, gifting, and smart shopping',
  };

  const bodyLines = (cleanedCaption || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^use[:\s]/i.test(l))
    .slice(0, 2);

  let body = bodyLines.join('\n');
  if (!body || body.length < 30) {
    body = `✨ Check out this ${productTitle || 'Amazon find'} for ${categoryUseCases[category] || categoryUseCases.general}.`;
  }

  const perfectFor = `\n\nPerfect for ${categoryUseCases[category] || categoryUseCases.general}.`;

  let dealLine = '';
  if (couponCode && dealType) {
    dealLine = `\n\n${dealType} — Use code: ${couponCode}`;
  } else if (couponCode) {
    dealLine = `\n\nUse code: ${couponCode}`;
  } else if (dealType) {
    dealLine = `\n\n🔥 ${dealType}`;
  }

  const shopLine = affiliateUrl ? `\nShop here 👇\n${affiliateUrl}` : '';
  const disclosure = '\n\n#ad As an Amazon Associate, I earn from qualifying purchases. Prices, deals, and coupon codes may change or end at any time.';

  return `${body}${perfectFor}${dealLine}${shopLine}${disclosure}`.trim();
}
/**
 * Generate 8–12 relevant hashtags.
 * @param {string} productTitle
 * @param {string} category
 * @param {string[]} categoryHashtags
 * @returns {string}
 */
function generateHashtags(productTitle, category, categoryHashtags) {
  const tags = new Set([...DEFAULT_HASHTAGS, ...(categoryHashtags || [])]);

  // Add a couple of title-derived tags
  if (productTitle) {
    const words = productTitle
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    if (words.length >= 2) {
      tags.add('#' + words.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(''));
    }
  }

  return [...tags].slice(0, 12).join(' ');
}

/**
 * Generate alt text for the Pinterest image.
 * @param {string} productTitle
 * @param {string} category
 * @returns {string}
 */
function generateAltText(productTitle, category) {
  const useCaseMap = {
    kitchen:          'everyday cooking and meal prep',
    tech:             'charging, connectivity, and smart home use',
    'home-organization': 'decluttering and home storage',
    beauty:           'skincare and self-care routines',
    fashion:          'everyday outfits and personal style',
    office:           'working from home and desk organization',
    fitness:          'home workouts and staying active',
    art:              'creative projects and crafts',
    eco:              'sustainable and eco-friendly living',
    kids:             'children\'s play and learning',
    pet:              'pet care and comfort',
    general:          'everyday use at home',
  };
  const useCase = useCaseMap[category] || 'everyday use';
  return `${productTitle || 'Amazon product'} shown as an Amazon find for ${useCase}.`;
}

/**
 * Full parse pipeline for a Facebook post caption.
 * @param {string} rawText
 * @param {string} affiliateUrl
 * @returns {{ productTitle, cleanedCaption, couponCode, dealType, category, board, pinterestTitle, pinterestDescription, hashtags, altText }}
 */
function parseCaption(rawText, affiliateUrl) {
  const cleanedCaption = cleanCaption(rawText);
  const productTitle   = extractProductTitle(rawText);
  const couponCode     = extractCouponCode(rawText);
  const dealType       = extractDealType(rawText);
  const { category, board, hashtags: catHashtags } = detectCategory(rawText);

  const pinterestTitle       = generatePinterestTitle(productTitle, category);
  const pinterestDescription = generatePinterestDescription({ productTitle, cleanedCaption, couponCode, dealType, affiliateUrl, category });
  const hashtags             = generateHashtags(productTitle, category, catHashtags);
  const altText              = generateAltText(productTitle, category);

  return { productTitle, cleanedCaption, couponCode, dealType, category, board, pinterestTitle, pinterestDescription, hashtags, altText };
}

if (typeof module !== 'undefined') {
  module.exports = { extractProductTitle, extractCouponCode, extractDealType, cleanCaption, detectCategory, generatePinterestTitle, generatePinterestDescription, generateHashtags, generateAltText, parseCaption };
}
