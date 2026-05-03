/**
 * utils/pinterest.js
 * Helpers for building Pinterest pin creation URLs and clipboard data.
 * All saves are MANUAL — user must publish themselves on Pinterest.
 */

/**
 * Build a Pinterest "Create Pin" URL with pre-filled parameters.
 * Pinterest's create URL supports: url, media, description.
 * Note: Pinterest may not honour all params depending on their current web app version.
 *
 * @param {{ imageUrl: string, destinationUrl: string, description: string }} options
 * @returns {string} Pinterest create URL
 */
function buildPinterestCreateUrl({ imageUrl, destinationUrl, description }) {
  const base = 'https://www.pinterest.com/pin/create/button/';
  const params = new URLSearchParams();

  if (destinationUrl) params.set('url',         destinationUrl);
  if (imageUrl)       params.set('media',        imageUrl);
  if (description)    params.set('description',  description.substring(0, 500)); // Pinterest description limit

  return `${base}?${params.toString()}`;
}

/**
 * Build the Pinterest "pin/create/bookmarklet" URL which sometimes
 * accepts more parameters including description pre-fill.
 */
function buildPinterestBookmarkletUrl({ imageUrl, destinationUrl, description }) {
  const base = 'https://www.pinterest.com/pin/create/bookmarklet/';
  const params = new URLSearchParams();

  if (destinationUrl) params.set('url',         destinationUrl);
  if (imageUrl)       params.set('media',        imageUrl);
  if (description)    params.set('description',  (description || '').substring(0, 500));

  return `${base}?${params.toString()}`;
}

/**
 * Build the direct Pinterest pin create page.
 * Opening this without params just opens the create flow,
 * but it's the most reliable way to ensure Pinterest loads.
 */
function buildPinterestCreatePage() {
  return 'https://www.pinterest.com/pin-creation-tool/';
}

/**
 * Generate clipboard-friendly formatted text for the Pinterest description.
 * This is what the user pastes into Pinterest's description field.
 * @param {{ description: string, hashtags: string }} data
 * @returns {string}
 */
function buildClipboardDescription({ description, hashtags }) {
  const hashtagLine = hashtags ? `\n\n${hashtags}` : '';
  return `${description}${hashtagLine}`.trim();
}

/**
 * Suggested tagged topics for Pinterest based on category.
 * These are shown to the user as suggestions; they paste them manually.
 */
const TOPIC_SUGGESTIONS = {
  kitchen:            ['Kitchen Gadgets', 'Cooking Essentials', 'Amazon Kitchen', 'Meal Prep Ideas', 'Home Chef Tools'],
  tech:               ['Tech Gadgets', 'Charging Essentials', 'Smart Home', 'Phone Accessories', 'Wireless Tech'],
  'home-organization':['Home Organization', 'Storage Solutions', 'Declutter Tips', 'Small Space Living', 'Pantry Organization'],
  beauty:             ['Skincare Routine', 'Beauty Essentials', 'Self Care', 'Amazon Beauty', 'Glow Up Tips'],
  fashion:            ['Amazon Fashion', 'Outfit Ideas', 'Style Finds', 'Affordable Fashion', 'Everyday Outfits'],
  office:             ['Home Office', 'Desk Setup', 'Work From Home', 'Office Organization', 'Productivity'],
  fitness:            ['Home Workout', 'Fitness Essentials', 'Wellness', 'Exercise Equipment', 'Healthy Lifestyle'],
  art:                ['Art Supplies', 'DIY Crafts', 'Creative Projects', 'Craft Ideas', 'Art And Craft'],
  eco:                ['Eco Friendly', 'Sustainable Living', 'Zero Waste', 'Green Living', 'Natural Products'],
  kids:               ['Kids Toys', 'Educational Toys', 'Toddler Activities', 'Children Learning', 'Family Finds'],
  pet:                ['Pet Essentials', 'Dog Accessories', 'Cat Finds', 'Pet Care', 'Animal Lover Gifts'],
  general:            ['Amazon Finds', 'Amazon Must Haves', 'Amazon Deals', 'Budget Friendly Finds', 'Daily Essentials'],
};

/**
 * Get topic suggestions for a given category.
 * @param {string} category
 * @returns {string[]}
 */
function getTopicSuggestions(category) {
  return TOPIC_SUGGESTIONS[category] || TOPIC_SUGGESTIONS.general;
}

if (typeof module !== 'undefined') {
  module.exports = { buildPinterestCreateUrl, buildPinterestBookmarkletUrl, buildPinterestCreatePage, buildClipboardDescription, getTopicSuggestions };
}
