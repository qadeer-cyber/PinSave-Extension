/**
 * popup.js
 * Main controller for the Affiliate Pin Saver popup UI (Phase 2).
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
  quickCapture:   null,   // { src, currentSrc, caption, amazonUrls, containerKind, capturedAt }
  source:         'picker', // 'quick-capture' | 'picker' | 'manual'
  containerKind:  null,   // 'article' | 'feed' | 'scored' | 'page-fallback' | null
};

// ─── DOM References ────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  loading:             $('loading'),
  mainContent:         $('main-content'),
  notFacebook:         $('not-facebook'),
  statusBar:           $('status-bar'),

  imagePickerSection:  $('image-picker-section'),
  imageGrid:           $('image-grid'),
  noImagesMsg:         $('no-images-msg'),
  previewSection:      $('preview-section'),
  selectedPreview:     $('selected-preview'),
  selectedPreviewLink: $('selected-preview-link'),
  quickCaptureHint:    $('quick-capture-hint'),

  amazonLinkPickerRow: $('amazon-link-picker-row'),
  amazonLinkPicker:    $('amazon-link-picker'),
  amazonLinksArea:     $('amazon-links-area'),
  noAmazonMsg:         $('no-amazon-msg'),
  manualAmazonUrl:     $('manual-amazon-url'),
  affiliateUrl:        $('affiliate-url'),
  affiliateWarning:    $('affiliate-warning'),
  imageWarning:        $('image-warning'),

  // Capture status diagnostics (Phase 2.1)
  capSource:           $('cap-source'),
  capImage:            $('cap-image'),
  capCaption:          $('cap-caption'),
  capLinks:            $('cap-links'),
  capAffiliate:        $('cap-affiliate'),
  capWarning:          $('cap-warning'),

  pinTitle:            $('pin-title'),
  pinDesc:             $('pin-description'),
  pinHashtags:         $('pin-hashtags'),
  pinAlt:              $('pin-alt'),
  couponCode:          $('coupon-code'),
  suggestedBoard:      $('suggested-board'),
  taggedTopics:        $('tagged-topics'),
  captionPreview:      $('caption-preview'),

  titleChars:          $('title-chars'),
  descChars:           $('desc-chars'),

  // Buttons
  btnRefresh:          $('btn-refresh'),
  btnOptions:          $('btn-options'),
  btnChangeImage:      $('btn-change-image'),
  btnCopyImageUrl:     $('btn-copy-image-url'),
  btnCopyTitle:        $('btn-copy-title'),
  btnCopyDescription:  $('btn-copy-description'),
  btnCopyHashtags:     $('btn-copy-hashtags'),
  btnCopyBoard:        $('btn-copy-board'),
  btnCopyTopics:       $('btn-copy-topics'),
  btnCopyAlt:          $('btn-copy-alt'),
  btnCopyAffiliate:    $('btn-copy-affiliate'),
  btnCopyCaption:      $('btn-copy-caption'),
  btnCopyFull:         $('btn-copy-full'),
  btnRegenerate:       $('btn-regenerate'),
  btnOpenPinterest:    $('btn-open-pinterest'),
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
  if (!text || !text.trim()) {
    showStatus('Nothing to copy yet.', 'warning');
    return;
  }
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

// ─── Capture Status (Phase 2.1) ────────────────────────────────────────────

function setCapValue(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.className = 'aps-cap-value' + (kind ? ` ${kind}` : '');
}

/**
 * Refresh the diagnostics panel from current state. Called after every
 * meaningful state change (scan, image select, link select, regenerate).
 */
function updateCaptureStatus() {
  // Source
  const srcLabel = state.source === 'quick-capture' ? 'Quick Capture'
                 : state.source === 'manual'        ? 'Manual'
                 : 'Image Picker';
  setCapValue(els.capSource, srcLabel, state.source === 'quick-capture' ? 'ok' : 'muted');

  // Image
  if (state.selectedSrc) {
    setCapValue(els.capImage, 'Selected', 'ok');
  } else {
    setCapValue(els.capImage, 'Missing', 'missing');
  }

  // Caption
  const captionLen = (state.caption || '').trim().length;
  if (captionLen >= 40) {
    let label = 'Extracted';
    let kind  = 'ok';
    if (state.containerKind === 'page-fallback') {
      label = 'Extracted (page fallback)';
      kind  = 'warn';
    } else if (state.source === 'manual') {
      label = 'Manually edited';
      kind  = 'ok';
    }
    setCapValue(els.capCaption, label, kind);
  } else if (captionLen > 0) {
    setCapValue(els.capCaption, 'Very short', 'warn');
  } else {
    setCapValue(els.capCaption, 'Missing', 'missing');
  }

  // Amazon links
  const n = state.amazonUrls.length;
  if (n === 0) {
    setCapValue(els.capLinks, '0 (paste manual URL)', 'missing');
  } else if (n === 1) {
    setCapValue(els.capLinks, '1 link', 'ok');
  } else {
    setCapValue(els.capLinks, `${n} links — pick one`, 'warn');
  }

  // Affiliate
  if (state.affiliateUrl) {
    setCapValue(els.capAffiliate, 'Generated', 'ok');
  } else if (!state.associateTag) {
    setCapValue(els.capAffiliate, 'Set Associate tag in Options', 'missing');
  } else if (n === 0 && !els.manualAmazonUrl.value.trim()) {
    setCapValue(els.capAffiliate, 'Needs Amazon URL', 'warn');
  } else {
    setCapValue(els.capAffiliate, 'Pending', 'warn');
  }

  // Aggregate warning line
  const warnings = [];
  if (state.containerKind === 'page-fallback') {
    warnings.push('Caption came from page-wide fallback — verify it matches the post.');
  }
  if (state.source === 'quick-capture' && captionLen < 40 && !state.amazonUrls.length) {
    warnings.push('Quick capture got very little text. Re-pick image or paste caption manually.');
  }
  if (warnings.length) {
    els.capWarning.textContent = warnings.join(' ');
    els.capWarning.classList.remove('hidden');
  } else {
    els.capWarning.classList.add('hidden');
  }
}

// ─── Image URL warnings (Phase 2.1) ────────────────────────────────────────

function evaluateImageUrl(url) {
  if (!url) return { ok: false, message: 'No image selected.' };

  if (/^blob:/i.test(url)) {
    return { ok: false, message: 'Image is a blob: URL — Pinterest cannot load it. Use Change Image or upload manually.' };
  }
  if (/^data:/i.test(url)) {
    return { ok: false, message: 'Image is a data: URL — Pinterest cannot load it. Use Change Image or upload manually.' };
  }
  if (url.length < 24) {
    return { ok: false, message: 'Image URL looks suspiciously short. It may not load on Pinterest.' };
  }
  // Facebook CDN URLs can include short-lived signatures (oh=, oe=).
  // They often work for a few hours but can expire — warn but don't block.
  if (/scontent[^.]*\.fbcdn\.net|fbsbx\.com/i.test(url) && /[?&](oh|oe|_nc_ohc|_nc_sid)=/i.test(url)) {
    return { ok: true, message: 'Facebook CDN URL — usually works, but the signed link can expire. Publish soon, or use Change Image / upload manually if Pinterest rejects it.' };
  }
  return { ok: true, message: '' };
}

function refreshImageWarning() {
  if (!els.imageWarning) return;
  const evald = evaluateImageUrl(state.selectedSrc || '');
  if (evald.message) {
    els.imageWarning.textContent = evald.message;
    els.imageWarning.classList.remove('hidden');
  } else {
    els.imageWarning.classList.add('hidden');
  }
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

  // ── Quick-capture support ───────────────────────────────────────────────
  // Phase 2 hover-click flow stores the clicked image URL + nearby post
  // caption + Amazon URLs into chrome.storage.session.quickCapture. We
  // consume it here, populate state, and clear it so it isn't reused.
  const session  = await chrome.storage.session.get(['quickCapture', 'hoverSelectedSrc']);
  const quickCap = session.quickCapture || null;
  const legacySrc = session.hoverSelectedSrc || null;
  await chrome.storage.session.remove(['quickCapture', 'hoverSelectedSrc']);

  if (quickCap && quickCap.src) {
    state.quickCapture  = quickCap;
    state.caption       = quickCap.caption || '';
    state.amazonUrls    = Array.isArray(quickCap.amazonUrls) ? quickCap.amazonUrls : [];
    state.source        = 'quick-capture';
    state.containerKind = quickCap.containerKind || null;
  } else {
    state.source        = 'picker';
    state.containerKind = null;
  }

  const preferSrc = (quickCap && quickCap.src) || legacySrc || null;
  await scanPage(tab.id, preferSrc);
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

    const scannedImages = resp.images || [];

    // If we have a quick-capture image, ensure it's in the list (prepend if
    // missing so the user always sees it as the chosen one).
    if (state.quickCapture && state.quickCapture.src) {
      const present = scannedImages.some(i => i.src === state.quickCapture.src);
      if (!present) {
        scannedImages.unshift({
          src:    state.quickCapture.src,
          width:  0,
          height: 0,
          score:  9999,
        });
      }
    }

    state.images = scannedImages;

    // Quick-capture provides caption/Amazon URLs already; otherwise use the
    // scan results.
    if (!state.quickCapture) {
      state.caption    = resp.caption    || '';
      state.amazonUrls = resp.amazonUrls || [];
    }

    renderImageGrid(preferSrc);
    renderAmazonLinks();
    renderCaptionPreview();

    // Hide the picker by default when quick-capture filled everything in;
    // user can click "Change Image" to bring it back.
    if (state.quickCapture && state.quickCapture.src) {
      els.imagePickerSection.classList.add('hidden');
      els.quickCaptureHint.classList.remove('hidden');
    } else {
      els.imagePickerSection.classList.remove('hidden');
      els.quickCaptureHint.classList.add('hidden');
    }

    // Auto-select the preferred (quick-capture or legacy hover) image,
    // falling back to the first scanned image.
    if (state.images.length > 0) {
      const initial = preferSrc
        ? (state.images.find(i => i.src === preferSrc) || state.images[0])
        : state.images[0];
      // When quick-capture is in play, don't overwrite the captured caption
      // by re-extracting from the page near this image.
      selectImage(initial, { reextractCaption: !state.quickCapture });
    } else if (state.quickCapture && state.quickCapture.src) {
      selectImage({ src: state.quickCapture.src }, { reextractCaption: false });
    } else {
      els.noImagesMsg.classList.remove('hidden');
    }

    if (state.amazonUrls.length > 0) {
      await selectAmazonUrl(state.amazonUrls[0]);
    } else {
      els.noAmazonMsg.classList.remove('hidden');
      // Still regenerate so the user sees the title/desc/hashtags even
      // without an Amazon link.
      regeneratePinterestContent();
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
    el.title        = img.width && img.height ? `${img.width}×${img.height}` : 'Captured image';
    el.loading      = 'lazy';
    if (img.src === preferSrc) el.classList.add('active');

    el.addEventListener('click', () => selectImage(img, { reextractCaption: true }));
    els.imageGrid.appendChild(el);
  });
}

function selectImage(imgData, opts = {}) {
  const { reextractCaption = true } = opts;
  state.selectedSrc = imgData.src;

  // Update grid UI
  els.imageGrid.querySelectorAll('.aps-image-thumb').forEach(el => {
    el.classList.toggle('active', el.src === imgData.src);
  });

  // Show preview
  els.selectedPreview.src          = imgData.src;
  els.selectedPreviewLink.href     = imgData.src;
  els.previewSection.classList.remove('hidden');
  refreshImageWarning();

  // Re-extract caption near this image if appropriate (skip when the
  // quick-capture flow already gave us the right caption).
  if (!reextractCaption) {
    regeneratePinterestContent();
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { action: 'extractCaption', nearSrc: imgData.src })
      .then(resp => {
        if (resp?.success && resp.caption) {
          state.caption       = resp.caption;
          state.amazonUrls    = resp.amazonUrls || [];
          state.containerKind = resp.containerKind || null;
          renderCaptionPreview();
          renderAmazonLinks();
          if (state.amazonUrls.length > 0) selectAmazonUrl(state.amazonUrls[0]);
          else regeneratePinterestContent();
        } else {
          regeneratePinterestContent();
        }
      })
      .catch(() => regeneratePinterestContent());
  });
}

// ─── Amazon Links Rendering ────────────────────────────────────────────────

function renderAmazonLinks() {
  // Clear previous radio rows + dropdown options.
  els.amazonLinksArea.querySelectorAll('.aps-amazon-link-option').forEach(el => el.remove());
  els.amazonLinkPicker.innerHTML = '';
  els.amazonLinkPickerRow.classList.add('hidden');
  els.noAmazonMsg.classList.add('hidden');

  if (state.amazonUrls.length === 0) {
    els.noAmazonMsg.classList.remove('hidden');
    return;
  }

  // 2+ links → use a real <select> dropdown so the user can pick the right
  // product link instead of clicking through tiny radios.
  if (state.amazonUrls.length > 1) {
    showStatus('Multiple Amazon links found. Pick the right one in the dropdown.', 'info');
    els.amazonLinkPickerRow.classList.remove('hidden');

    state.amazonUrls.forEach((url, i) => {
      const opt = document.createElement('option');
      opt.value       = url;
      opt.textContent = `${i + 1}. ${url}`;
      if (i === 0) opt.selected = true;
      els.amazonLinkPicker.appendChild(opt);
    });
    return;
  }

  // Single link → keep the original radio row for visibility.
  const url = state.amazonUrls[0];
  const wrap = document.createElement('label');
  wrap.className = 'aps-amazon-link-option active';
  wrap.dataset.url = url;

  const radio = document.createElement('input');
  radio.type    = 'radio';
  radio.name    = 'amazon-url';
  radio.value   = url;
  radio.checked = true;

  const span = document.createElement('span');
  span.textContent = url;

  wrap.appendChild(radio);
  wrap.appendChild(span);
  wrap.addEventListener('click', () => selectAmazonUrl(url));

  els.amazonLinksArea.insertBefore(wrap, els.noAmazonMsg);
}

async function selectAmazonUrl(rawUrl) {
  if (!rawUrl) return;
  state.selectedAmazon = rawUrl;

  els.amazonLinksArea.querySelectorAll('.aps-amazon-link-option').forEach(el => {
    const radio = el.querySelector('input[type="radio"]');
    const isMe  = el.dataset.url === rawUrl;
    el.classList.toggle('active', isMe);
    if (radio) radio.checked = isMe;
  });

  // Keep dropdown in sync if it exists.
  if (els.amazonLinkPicker && els.amazonLinkPicker.value !== rawUrl) {
    const match = Array.from(els.amazonLinkPicker.options).find(o => o.value === rawUrl);
    if (match) els.amazonLinkPicker.value = rawUrl;
  }

  await resolveAndConvert(rawUrl);
}

async function resolveAndConvert(rawUrl) {
  const tag = state.associateTag;

  if (!tag) {
    els.affiliateUrl.value = '';
    showWarning('Amazon Associate tag is missing. Go to Options to set it.');
    regeneratePinterestContent();
    return;
  }

  // Resolve short link first.
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

  const { affiliateUrl, warning } = normalizeAmazonUrl(rawUrl, tag);

  state.affiliateUrl  = affiliateUrl;
  state.affiliateWarn = warning;

  els.affiliateUrl.value = affiliateUrl || '';

  if (warning) showWarning(warning);
  else els.affiliateWarning.classList.add('hidden');

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

  const {
    couponCode,
    pinterestTitle,
    pinterestDescription,
    hashtags,
    altText,
    suggestedBoard,
    taggedTopics,
  } = state.parsed;

  els.pinTitle.value       = pinterestTitle       || '';
  els.pinDesc.value        = pinterestDescription || '';
  els.pinHashtags.value    = hashtags             || '';
  els.pinAlt.value         = altText              || '';
  els.couponCode.value     = couponCode           || '';
  els.suggestedBoard.value = suggestedBoard       || 'Amazon Finds & Daily Deals';
  els.taggedTopics.value   = Array.isArray(taggedTopics) ? taggedTopics.join(', ') : '';

  updateCharCounts();
  updateCaptureStatus();
}

function renderCaptionPreview() {
  els.captionPreview.value = state.caption || '';
}

// ─── Full Pin Package ──────────────────────────────────────────────────────

function buildFullPinPackage() {
  const title       = els.pinTitle.value.trim();
  const description = els.pinDesc.value.trim();
  const hashtags    = els.pinHashtags.value.trim();
  const board       = els.suggestedBoard.value.trim();
  const topics      = els.taggedTopics.value.trim();
  const alt         = els.pinAlt.value.trim();
  const affiliate   = state.affiliateUrl || els.affiliateUrl.value.trim() || '';

  return [
    'Title:',         title,             '',
    'Description:',   description,       '',
    'Hashtags:',      hashtags,          '',
    'Board:',         board,             '',
    'Tagged Topics:', topics,            '',
    'Alt Text:',      alt,               '',
    'Affiliate Link:', affiliate,
  ].join('\n');
}

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

  // Auto-copy the Full Pin Package so the user can paste any field on
  // Pinterest even if Pinterest ignores ?description= URL params.
  const fullPin = buildFullPinPackage();
  let copied = false;
  navigator.clipboard.writeText(fullPin).then(() => { copied = true; }).catch(() => {});

  const pinterestUrl = buildPinterestCreateUrl({
    imageUrl,
    destinationUrl,
    description: (description + (hashtags ? '\n' + hashtags : '')).substring(0, 500),
  });

  chrome.runtime.sendMessage({ action: 'openTab', url: pinterestUrl })
    .then(() => {
      // Re-check copy state after the async clipboard call resolved.
      setTimeout(() => {
        if (copied) {
          showStatus('Pinterest opened. Full pin package copied to clipboard.', 'success');
        } else {
          showStatus('Pinterest opened. Use Copy Full Pin Package, then paste manually.', 'info');
        }
      }, 50);
    })
    .catch(() => {
      showStatus('Could not open Pinterest. Copy the affiliate link and open Pinterest manually.', 'error');
    });
}

// ─── Event Bindings ────────────────────────────────────────────────────────

function bindEvents(tabId) {

  els.btnRefresh.addEventListener('click', () => {
    state.quickCapture  = null;
    state.source        = 'picker';
    state.containerKind = null;
    scanPage(tabId, null);
  });

  els.btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Manual Amazon URL — Phase 2.1 fallback when Facebook detection fails.
  // Switches the source label to 'manual' so Capture Status shows the
  // user is overriding.
  els.manualAmazonUrl.addEventListener('change', async () => {
    const val = els.manualAmazonUrl.value.trim();
    if (!val) return;
    state.source = 'manual';
    await resolveAndConvert(val);
  });

  // Multiple-link dropdown selector (Phase 2.1).
  if (els.amazonLinkPicker) {
    els.amazonLinkPicker.addEventListener('change', async () => {
      const val = els.amazonLinkPicker.value;
      if (val) await selectAmazonUrl(val);
    });
  }

  // Editable caption — track edits so the user can re-generate against
  // their own text when Facebook extraction failed.
  els.captionPreview.addEventListener('input', () => {
    state.caption = els.captionPreview.value;
    state.source  = 'manual';
    updateCaptureStatus();
  });

  // Re-generate Pin Package (Phase 2.1).
  if (els.btnRegenerate) {
    els.btnRegenerate.addEventListener('click', async () => {
      // If the user typed a manual Amazon URL, prefer it over auto-detection.
      const manual = els.manualAmazonUrl.value.trim();
      if (manual) {
        state.source = 'manual';
        await resolveAndConvert(manual);
      } else {
        regeneratePinterestContent();
      }
      showStatus('Pin Package regenerated from current caption + Amazon URL.', 'success');
    });
  }

  // Live char counts + keep state.parsed in sync with edits
  els.pinTitle.addEventListener('input', updateCharCounts);
  els.pinDesc.addEventListener('input', () => {
    updateCharCounts();
    if (state.parsed) state.parsed.pinterestDescription = els.pinDesc.value;
  });
  els.pinHashtags.addEventListener('input', () => {
    if (state.parsed) state.parsed.hashtags = els.pinHashtags.value;
  });
  els.pinAlt.addEventListener('input', () => {
    if (state.parsed) state.parsed.altText = els.pinAlt.value;
  });

  // Change image — re-show the picker so the user can override.
  if (els.btnChangeImage) {
    els.btnChangeImage.addEventListener('click', () => {
      els.imagePickerSection.classList.remove('hidden');
      els.quickCaptureHint.classList.add('hidden');
      state.source = 'picker';
      updateCaptureStatus();
      // Smooth scroll the picker into view.
      els.imagePickerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Copy Image URL (Phase 2.1)
  if (els.btnCopyImageUrl) {
    els.btnCopyImageUrl.addEventListener('click', () => {
      copyToClipboard(state.selectedSrc || '', 'Image URL');
    });
  }

  // Per-field copy buttons
  els.btnCopyTitle      && els.btnCopyTitle      .addEventListener('click', () => copyToClipboard(els.pinTitle.value.trim(),       'Pinterest title'));
  els.btnCopyDescription&& els.btnCopyDescription.addEventListener('click', () => copyToClipboard(els.pinDesc.value.trim(),        'Pinterest description'));
  els.btnCopyHashtags   && els.btnCopyHashtags   .addEventListener('click', () => copyToClipboard(els.pinHashtags.value.trim(),    'Hashtags'));
  els.btnCopyBoard      && els.btnCopyBoard      .addEventListener('click', () => copyToClipboard(els.suggestedBoard.value.trim(), 'Board name'));
  els.btnCopyTopics     && els.btnCopyTopics     .addEventListener('click', () => copyToClipboard(els.taggedTopics.value.trim(),   'Tagged topics'));
  els.btnCopyAlt        && els.btnCopyAlt        .addEventListener('click', () => copyToClipboard(els.pinAlt.value.trim(),         'Alt text'));
  els.btnCopyCaption    && els.btnCopyCaption    .addEventListener('click', () => copyToClipboard(els.captionPreview.value.trim(), 'Facebook caption'));

  els.btnCopyAffiliate.addEventListener('click', () => {
    const url = state.affiliateUrl || els.affiliateUrl.value.trim();
    copyToClipboard(url, 'Affiliate link');
  });

  // Full Pin Package
  els.btnCopyFull && els.btnCopyFull.addEventListener('click', () => {
    copyToClipboard(buildFullPinPackage(), 'Full Pin Package');
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
