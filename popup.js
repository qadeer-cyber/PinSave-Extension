/**
 * popup.js
 * Main controller for the Affiliate Pin Saver popup UI.
 */

'use strict';

// ─── State ─────────────────────────────────────────────────────────────────

let state = {
  images:         [],     // { src, width, height, score }[]
  selectedSrc:    null,   // currently selected image URL
  caption:        '',     // raw extracted caption
  amazonUrls:     [],     // detected Amazon URLs in caption
  selectedAmazon: null,   // which Amazon URL the user picked
  affiliateUrl:   null,   // final converted affiliate URL
  affiliateWarn:  null,   // warning message
  parsed:         null,   // result from parseCaption()
  associateTag:   '',     // loaded from storage
  settings:       {},     // all settings from chrome.storage.local
};

// ─── DOM References ────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  loading:          $('loading'),
  mainContent:      $('main-content'),
  notFacebook:      $('not-facebook'),
  statusBar:        $('status-bar'),
  imageGrid:        $('image-grid'),
  noImagesMsg:      $('no-images-msg'),
  previewSection:   $('preview-section'),
  selectedPreview:  $('selected-preview'),
  selectedPreviewLink: $('selected-preview-link'),
  amazonLinksArea:  $('amazon-links-area'),
  noAmazonMsg:      $('no-amazon-msg'),
  manualAmazonUrl:  $('manual-amazon-url'),
  affiliateUrl:     $('affiliate-url'),
  affiliateWarning: $('affiliate-warning'),
  pinTitle:         $('pin-title'),
  pinDesc:          $('pin-description'),
  pinHashtags:      $('pin-hashtags'),
  pinAlt:           $('pin-alt'),
  couponCode:       $('coupon-code'),
  suggestedBoard:   $('suggested-board'),
  taggedTopics:     $('tagged-topics'),
  captionPreview:   $('caption-preview'),
  titleChars:       $('title-chars'),
  descChars:        $('desc-chars'),
  btnRefresh:       $('btn-refresh'),
  btnOptions:       $('btn-options'),
  btnCopyAffiliate: $('btn-copy-affiliate'),
  btnCopyCaption:   $('btn-copy-caption'),
  btnCopyBoard:     $('btn-copy-board'),
  btnOpenPinterest: $('btn-open-pinterest'),
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function showStatus(msg, type = 'info') {
  els.statusBar.textContent = msg;
  els.statusBar.className   = `aps-status ${type}`;
  els.statusBar.classList.remove('hidden');
  setTimeout(() => els.statusBar.classList.add('hidden'), 4000);
}

function setLoading(on) {
  els.loading.classList.toggle('hidden', !on);
  els.mainContent.classList.toggle('hidden', on);
}

async function copyToClipboard(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus(`${label} copied.`, 'success');
  } catch {
    showStatus('Could not copy. Please copy manually.', 'error');
  }
}

function updateCharCounts() {
  const title = els.pinTitle.value;
  const desc  = els.pinDesc.value;
  els.titleChars.textContent = `${title.length}/100`;
  els.descChars.textContent  = `${desc.length}/500`;
  els.titleChars.style.color = title.length > 90 ? '#c62828' : '#767676';
  els.descChars.style.color  = desc.length  > 480 ? '#c62828' : '#767676';
}

// ─── Init ──────────────────────────────────────────────────────────────────

async function init() {
  // Load settings
  const stored = await chrome.storage.local.get([
    'associateTag', 'hoverButtonsEnabled', 'defaultBoard', 'defaultDisclosure',
    'defaultPriceDisclaimer', 'defaultCategory', 'facebookOnlyMode',
  ]);
  state.settings    = stored;
  state.associateTag = (stored.associateTag || '').trim();

  // Check if on Facebook
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url   = tab?.url || '';
  const onFB  = /^https?:\/\/(www\.|m\.)?facebook\.com/.test(url);

  if (!onFB) {
    els.loading.classList.add('hidden');
    els.notFacebook.classList.remove('hidden');
    return;
  }

  if (!state.associateTag) {
    showStatus('Amazon Associate tag not set. Go to Options.', 'warning');
  }

  // Check if hover image was selected via context menu / hover button
  const session = await chrome.storage.session.get(['hoverSelectedSrc']);
  const hoverSrc = session.hoverSelectedSrc || null;
  if (hoverSrc) {
    await chrome.storage.session.remove('hoverSelectedSrc');
  }

  await scanPage(tab.id, hoverSrc);
  bindEvents(tab.id);
}

// ─── Page Scan ─────────────────────────────────────────────────────────────

async function scanPage(tabId, preferSrc) {
  setLoading(true);
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'scanPage' });

    if (!resp || !resp.success) {
      throw new Error(resp?.error || 'Content script did not respond. Try refreshing the Facebook page.');
    }

    state.images     = resp.images    || [];
    state.caption    = resp.caption   || '';
    state.amazonUrls = resp.amazonUrls || [];

    renderImageGrid(preferSrc);
    renderAmazonLinks();
    renderCaptionPreview();

    // Auto-select first image
    if (state.images.length > 0) {
      selectImage(preferSrc ? (state.images.find(i => i.src === preferSrc) || state.images[0]) : state.images[0]);
    } else {
      els.noImagesMsg.classList.remove('hidden');
    }

    // Auto-select first Amazon URL
    if (state.amazonUrls.length > 0) {
      await selectAmazonUrl(state.amazonUrls[0]);
    } else {
      els.noAmazonMsg.classList.remove('hidden');
    }

    setLoading(false);

  } catch (e) {
    setLoading(false);
    els.mainContent.classList.remove('hidden');
    showStatus(e.message, 'error');
  }
}

// ─── Image Grid Rendering ──────────────────────────────────────────────────

function renderImageGrid(preferSrc) {
  els.imageGrid.innerHTML = '';
  els.noImagesMsg.classList.add('hidden');

  if (state.images.length === 0) {
    els.noImagesMsg.classList.remove('hidden');
    return;
  }

  state.images.forEach(img => {
    const el = document.createElement('img');
    el.src          = img.src;
    el.alt          = 'Product image option';
    el.className    = 'aps-image-thumb';
    el.role         = 'option';
    el.title        = `${img.width}×${img.height}`;
    el.loading      = 'lazy';
    if (img.src === preferSrc) el.classList.add('active');

    el.addEventListener('click', () => selectImage(img));
    els.imageGrid.appendChild(el);
  });
}

function selectImage(imgData) {
  state.selectedSrc = imgData.src;

  // Update grid UI
  els.imageGrid.querySelectorAll('.aps-image-thumb').forEach(el => {
    el.classList.toggle('active', el.src === imgData.src);
  });

  // Show preview
  els.selectedPreview.src          = imgData.src;
  els.selectedPreviewLink.href     = imgData.src;
  els.previewSection.classList.remove('hidden');

  // Re-extract caption near this image if possible
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { action: 'extractCaption', nearSrc: imgData.src })
      .then(resp => {
        if (resp?.success && resp.caption) {
          state.caption    = resp.caption;
          state.amazonUrls = resp.amazonUrls || [];
          renderCaptionPreview();
          renderAmazonLinks();
          if (state.amazonUrls.length > 0) selectAmazonUrl(state.amazonUrls[0]);
        }
      })
      .catch(() => {});
  });
}

// ─── Amazon Links Rendering ────────────────────────────────────────────────

function renderAmazonLinks() {
  // Clear previous options (keep no-amazon-msg and manual input)
  els.amazonLinksArea.querySelectorAll('.aps-amazon-link-option').forEach(el => el.remove());
  els.noAmazonMsg.classList.add('hidden');

  if (state.amazonUrls.length === 0) {
    els.noAmazonMsg.classList.remove('hidden');
    return;
  }

  if (state.amazonUrls.length > 1) {
    showStatus('Multiple Amazon links found. Select one.', 'info');
  }

  state.amazonUrls.forEach((url, i) => {
    const wrap = document.createElement('label');
    wrap.className = 'aps-amazon-link-option';
    wrap.dataset.url = url;

    const radio = document.createElement('input');
    radio.type  = 'radio';
    radio.name  = 'amazon-url';
    radio.value = url;
    if (i === 0) radio.checked = true;

    const span = document.createElement('span');
    span.textContent = url;

    wrap.appendChild(radio);
    wrap.appendChild(span);
    wrap.addEventListener('click', () => selectAmazonUrl(url));

    // Insert before the no-amazon message
    els.amazonLinksArea.insertBefore(wrap, els.noAmazonMsg);
  });
}

async function selectAmazonUrl(rawUrl) {
  if (!rawUrl) return;
  state.selectedAmazon = rawUrl;

  // Mark radio as selected
  els.amazonLinksArea.querySelectorAll('.aps-amazon-link-option').forEach(el => {
    const radio = el.querySelector('input[type="radio"]');
    const isMe  = el.dataset.url === rawUrl;
    el.classList.toggle('active', isMe);
    if (radio) radio.checked = isMe;
  });

  await resolveAndConvert(rawUrl);
}

async function resolveAndConvert(rawUrl) {
  const tag = state.associateTag;

  if (!tag) {
    els.affiliateUrl.value = '';
    showWarning('Amazon Associate tag is missing. Go to Options to set it.');
    return;
  }

  // Check if short URL — resolve first
  if (isShortAmazonUrl(rawUrl)) {
    showStatus('Resolving short Amazon link…', 'info');
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'resolveShortUrl', url: rawUrl });
      if (resp.success && resp.resolvedUrl) {
        rawUrl = resp.resolvedUrl;
        showStatus('Short link resolved.', 'success');
      } else {
        showWarning('Could not resolve short Amazon link. Paste the full Amazon URL manually.');
        els.affiliateUrl.value = '';
        state.affiliateUrl = null;
        regeneratePinterestContent();
        return;
      }
    } catch {
      showWarning('Could not resolve short link. Paste the full Amazon URL manually.');
      els.affiliateUrl.value = '';
      state.affiliateUrl = null;
      regeneratePinterestContent();
      return;
    }
  }

  const { affiliateUrl, asin, warning } = normalizeAmazonUrl(rawUrl, tag);

  state.affiliateUrl  = affiliateUrl;
  state.affiliateWarn = warning;

  if (affiliateUrl) {
    els.affiliateUrl.value = affiliateUrl;
  } else {
    els.affiliateUrl.value = '';
  }

  if (warning) {
    showWarning(warning);
  } else {
    els.affiliateWarning.classList.add('hidden');
  }

  regeneratePinterestContent();
}

function showWarning(msg) {
  els.affiliateWarning.textContent = msg;
  els.affiliateWarning.classList.remove('hidden');
}

// ─── Pinterest Content Generation ──────────────────────────────────────────

function regeneratePinterestContent() {
  const affiliateUrl = state.affiliateUrl || '';
  state.parsed = parseCaption(state.caption, affiliateUrl);

  const { productTitle, cleanedCaption, couponCode, pinterestTitle, pinterestDescription, hashtags, altText, board, category } = state.parsed;

  els.pinTitle.value     = pinterestTitle    || '';
  els.pinDesc.value      = pinterestDescription || '';
  els.pinHashtags.value  = hashtags          || '';
  els.pinAlt.value       = altText           || '';
  els.couponCode.value   = couponCode        || '';
  els.suggestedBoard.value = board           || 'Amazon Finds';
  els.taggedTopics.value = getTopicSuggestions(category).join(', ');

  updateCharCounts();
}

function renderCaptionPreview() {
  els.captionPreview.value = state.caption || '';
}

// ─── Manual Amazon Input ───────────────────────────────────────────────────

els.manualAmazonUrl.addEventListener('change', async () => {
  const val = els.manualAmazonUrl.value.trim();
  if (val) await resolveAndConvert(val);
});

// ─── Character Counts ──────────────────────────────────────────────────────

els.pinTitle.addEventListener('input', updateCharCounts);
els.pinDesc.addEventListener('input', updateCharCounts);

// When user edits description, update state (for open pinterest)
els.pinDesc.addEventListener('input', () => {
  if (state.parsed) state.parsed.pinterestDescription = els.pinDesc.value;
});

// ─── Open Pinterest ────────────────────────────────────────────────────────

function openPinterest() {
  const imageUrl       = state.selectedSrc || '';
  const destinationUrl = state.affiliateUrl || els.affiliateUrl.value.trim() || '';
  const description    = els.pinDesc.value.trim();
  const hashtags       = els.pinHashtags.value.trim();

  if (!imageUrl) {
    showStatus('Please select a product image first.', 'warning');
    return;
  }
  if (!destinationUrl) {
    showStatus('No affiliate link set. Please set or paste an Amazon link.', 'warning');
    return;
  }

  // Build clipboard text (title + description + hashtags)
  const fullClip = [
    els.pinTitle.value.trim(),
    '',
    description,
    hashtags ? `\n${hashtags}` : '',
  ].join('\n').trim();

  // Copy to clipboard for easy paste
  navigator.clipboard.writeText(fullClip).catch(() => {});

  // Try to open Pinterest create with params
  const pinterestUrl = buildPinterestCreateUrl({
    imageUrl,
    destinationUrl,
    description: (description + (hashtags ? '\n' + hashtags : '')).substring(0, 500),
  });

  chrome.runtime.sendMessage({ action: 'openTab', url: pinterestUrl })
    .then(() => {
      showStatus('Pinterest opened. Paste description from clipboard and publish manually.', 'success');
    })
    .catch(() => {
      showStatus('Could not open Pinterest. Copy the affiliate link and open Pinterest manually.', 'error');
    });
}

// ─── Event Bindings ────────────────────────────────────────────────────────

function bindEvents(tabId) {

  els.btnRefresh.addEventListener('click', () => scanPage(tabId, null));

  els.btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  els.btnCopyAffiliate.addEventListener('click', () => {
    const url = state.affiliateUrl || els.affiliateUrl.value.trim();
    if (url) copyToClipboard(url, 'Affiliate link');
    else showStatus('No affiliate link to copy.', 'warning');
  });

  els.btnCopyCaption.addEventListener('click', () => {
    const text = [
      els.pinTitle.value.trim(),
      '',
      els.pinDesc.value.trim(),
      els.pinHashtags.value.trim(),
    ].join('\n').trim();
    if (text) copyToClipboard(text, 'Pinterest caption');
    else showStatus('Nothing to copy yet.', 'warning');
  });

  els.btnCopyBoard.addEventListener('click', () => {
    copyToClipboard(els.suggestedBoard.value, 'Board name');
  });

  els.btnOpenPinterest.addEventListener('click', openPinterest);
}

// ─── Boot ──────────────────────────────────────────────────────────────────

init().catch(e => {
  console.error('[AffiliatePin] Init error:', e);
  els.loading.classList.add('hidden');
  els.mainContent.classList.remove('hidden');
  showStatus('Extension error: ' + e.message, 'error');
});
