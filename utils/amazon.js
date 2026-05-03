/**
 * utils/amazon.js
 * Amazon link detection, ASIN extraction, and affiliate URL conversion.
 */

const AMAZON_DOMAINS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de',
  'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.co.jp',
  'amazon.in', 'amazon.com.au', 'amazon.com.br', 'amazon.com.mx'
];

const SHORT_DOMAINS = ['amzn.to', 'a.co', 'amzn.com'];

/**
 * Regex patterns for Amazon URLs in text.
 */
const AMAZON_URL_REGEX = /https?:\/\/(?:www\.)?(?:amzn\.to|a\.co|amzn\.com|amazon(?:\.com(?:\.au|\.br|\.mx)?|\.co(?:\.uk|\.jp)?|\.ca|\.de|\.fr|\.it|\.es|\.in))[^\s"'<>)}\]]+/gi;

/**
 * Find all Amazon URLs in a block of text.
 * @param {string} text
 * @returns {string[]} Array of raw Amazon URLs found
 */
function findAmazonUrls(text) {
  if (!text) return [];
  const matches = text.match(AMAZON_URL_REGEX) || [];
  // Deduplicate while preserving order
  return [...new Set(matches.map(u => u.replace(/[.,;!?]+$/, '')))];
}

/**
 * Check whether a URL is a known short Amazon redirect.
 * @param {string} url
 * @returns {boolean}
 */
function isShortAmazonUrl(url) {
  try {
    const { hostname } = new URL(url);
    return SHORT_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Extract ASIN from a full Amazon URL.
 * Supports:
 *   /dp/ASIN
 *   /gp/product/ASIN
 *   /product/ASIN
 *   /exec/obidos/ASIN/ASIN
 *   ?ASIN= query param (rare)
 * @param {string} url
 * @returns {string|null} ASIN (10 chars, alphanumeric) or null
 */
function extractASIN(url) {
  if (!url) return null;

  // Patterns in path
  const pathPatterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/exec\/obidos\/(?:ASIN\/)?([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/o\/ASIN\/([A-Z0-9]{10})(?:[/?]|$)/i,
  ];

  for (const pattern of pathPatterns) {
    const match = url.match(pattern);
    if (match && match[1].length === 10) return match[1].toUpperCase();
  }

  // Query string: ?ASIN=XXXXXXXXXX
  try {
    const { searchParams } = new URL(url);
    const asinParam = searchParams.get('ASIN') || searchParams.get('asin');
    if (asinParam && /^[A-Z0-9]{10}$/i.test(asinParam)) return asinParam.toUpperCase();
  } catch {
    // ignore malformed URLs
  }

  return null;
}

/**
 * Build a clean Amazon affiliate URL from ASIN and associate tag.
 * @param {string} asin
 * @param {string} tag  Amazon Associate tag
 * @returns {string}
 */
function buildAffiliateUrl(asin, tag) {
  return `https://www.amazon.com/dp/${asin}/?tag=${encodeURIComponent(tag)}`;
}

/**
 * Normalize any Amazon URL to an affiliate URL.
 * - Replaces existing tag with user tag.
 * - If ASIN found, uses clean /dp/ASIN form.
 * - If no ASIN, just swaps/adds tag param.
 * Returns null if URL is a short link (caller must resolve first).
 *
 * @param {string} url  Full Amazon URL (not short link)
 * @param {string} tag  Amazon Associate tag
 * @returns {{ affiliateUrl: string, asin: string|null, warning: string|null }}
 */
function normalizeAmazonUrl(url, tag) {
  if (!tag) {
    return { affiliateUrl: url, asin: null, warning: 'Amazon Associate tag is missing. Please set it in Options.' };
  }

  if (isShortAmazonUrl(url)) {
    return { affiliateUrl: null, asin: null, warning: 'Short Amazon link must be resolved first.' };
  }

  const asin = extractASIN(url);

  if (asin) {
    return {
      affiliateUrl: buildAffiliateUrl(asin, tag),
      asin,
      warning: null
    };
  }

  // No ASIN found — try to add/replace tag in original URL
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('tag', tag);
    // Remove other referral/tracking params to keep it clean
    parsed.searchParams.delete('linkCode');
    parsed.searchParams.delete('linkId');
    parsed.searchParams.delete('ref');
    parsed.searchParams.delete('ref_');
    return {
      affiliateUrl: parsed.toString(),
      asin: null,
      warning: 'ASIN could not be extracted. Original URL preserved with your tag added. Verify the link manually.'
    };
  } catch {
    return {
      affiliateUrl: url,
      asin: null,
      warning: 'Could not parse Amazon URL. Please paste your affiliate link manually.'
    };
  }
}

/**
 * Determine if a URL belongs to an Amazon domain (full, not short).
 * @param {string} url
 * @returns {boolean}
 */
function isFullAmazonUrl(url) {
  try {
    const { hostname } = new URL(url);
    return AMAZON_DOMAINS.some(d => hostname === d || hostname === 'www.' + d);
  } catch {
    return false;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { findAmazonUrls, isShortAmazonUrl, extractASIN, buildAffiliateUrl, normalizeAmazonUrl, isFullAmazonUrl };
}
