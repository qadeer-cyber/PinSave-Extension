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
  lastTabId:      null,   // active tab id (for re-injection / refresh)
};

// ─── DOM References ────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  loading:             $('loading'),
  mainContent:         $('main-content'),
  notFacebook:         $('not-facebook'),
  notFacebookHeadline: $('not-facebook-headline'),
  notFacebookDetail:   $('not-facebook-detail'),
  btnInjectHelper:     $('btn-inject-helper'),
  statusBar:           $('status-bar'),

  // Start screen + progressive disclosure
  startSection:        $('start-section'),
  btnScanPage:         $('btn-scan-page'),
  btnPasteAmazon:      $('btn-paste-amazon'),
  btnStartOptions:     $('btn-start-options'),
  setupWarning:        $('setup-warning'),
  btnSetupOptions:     $('btn-setup-options'),
  captureStatusSection:$('capture-status-section'),
  amazonSection:       $('amazon-section'),
  pinterestSection:    $('pinterest-section'),
  pinEmptyHint:        $('pin-empty-hint'),
  captionSection:      $('caption-section'),
  actionsSection:      $('actions-section'),

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
  btnSaveQueue:        $('btn-save-queue'),
  btnOpenQueue:        $('btn-open-queue'),

  // Duplicate-warning modal
  dupModal:            $('dup-modal'),
  dupMessage:          $('dup-message'),
  dupExisting:         $('dup-existing'),
  btnDupView:          $('btn-dup-view'),
  btnDupCancel:        $('btn-dup-cancel'),
  btnDupSave:          $('btn-dup-save'),

  // Phase 4 — Pin Quality
  qualitySection:      $('quality-section'),
  qualityBadge:        $('quality-badge'),
  qualityWarnings:     $('quality-warnings'),
  btnAutoFix:          $('btn-auto-fix'),

  qualModal:           $('qual-modal'),
  qualMessage:         $('qual-message'),
  qualWarnings:        $('qual-warnings'),
  btnQualCancel:       $('btn-qual-cancel'),
  btnQualAutofix:      $('btn-qual-autofix'),
  btnQualSave:         $('btn-qual-save'),
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

// ─── Defensive text helper (mirrors content.js safeText) ───────────────────

/**
 * Trim a value to a non-empty string. Returns fallback for null/undefined/
 * empty/whitespace and the literal strings "undefined" / "null". Used for
 * any UI label that could otherwise leak the word "undefined".
 */
function safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  if (!s || /^(undefined|null)$/i.test(s)) return fallback;
  return s;
}

// ─── Section visibility helpers ────────────────────────────────────────────

function _show(el)  { if (el) el.classList.remove('hidden'); }
function _hide(el)  { if (el) el.classList.add('hidden'); }

/**
 * Show the clean "Start a Pin" card and hide everything else. Used when the
 * user opens the popup directly (no Quick Capture handoff).
 */
function showStartScreen() {
  state.uiMode = 'start';
  _show(els.startSection);
  _hide(els.captureStatusSection);
  _hide(els.imagePickerSection);
  _hide(els.previewSection);
  _hide(els.amazonSection);
  _hide(els.pinterestSection);
  _hide(els.captionSection);
  _hide(els.qualitySection);
  _hide(els.actionsSection);
  _hide(els.noImagesMsg);
}

/**
 * Reveal the full pin-building workflow (capture status + preview + amazon +
 * pinterest content + caption + quality + actions). Used after Quick Capture
 * or after the user picks an image / pastes a manual Amazon URL.
 */
function showWorkingSections() {
  state.uiMode = 'working';
  _hide(els.startSection);
  _show(els.captureStatusSection);
  _show(els.previewSection);
  _show(els.amazonSection);
  _show(els.captionSection);
  _show(els.actionsSection);
  // Pinterest content + quality only show once we have something usable.
  applyProgressiveDisclosure();
}

/**
 * Show the "manual paste" entry point: caption + amazon manual URL fields,
 * plus the actions bar. No image gallery, no preview until the user supplies
 * an image. Used by the Start screen's "Paste Amazon URL Manually" button.
 */
function showManualEntry() {
  state.uiMode = 'manual';
  _hide(els.startSection);
  _show(els.captureStatusSection);
  _show(els.amazonSection);
  _show(els.captionSection);
  _show(els.actionsSection);
  // Image preview and Pinterest content stay hidden until the user picks
  // an image and the package has something to show.
  applyProgressiveDisclosure();
  // Focus the manual URL field so the user can paste immediately.
  if (els.manualAmazonUrl) {
    setTimeout(() => els.manualAmazonUrl.focus(), 0);
  }
}

/**
 * Toggle Pinterest content + Quality sections based on whether we have
 * meaningful inputs (image AND (caption OR Amazon URL)). Keeps the popup
 * from showing empty / stale Pinterest fields with a fake quality score.
 */
function applyProgressiveDisclosure() {
  const hasImage   = !!state.selectedSrc;
  const hasCaption = (state.caption || '').trim().length > 0
                  || (els.captionPreview && els.captionPreview.value.trim().length > 0);
  const hasAmazon  = !!state.selectedAmazon
                  || !!state.affiliateUrl
                  || (els.manualAmazonUrl && !!els.manualAmazonUrl.value.trim());
  const ready      = hasImage && (hasCaption || hasAmazon);

  if (ready) {
    _show(els.pinterestSection);
    _show(els.qualitySection);
    _hide(els.pinEmptyHint);
  } else {
    // Hide Pinterest content + quality so we don't display a stale
    // 97/100 score next to garbage metadata-derived titles.
    if (state.uiMode === 'working' || state.uiMode === 'manual') {
      _hide(els.pinterestSection);
      _hide(els.qualitySection);
    }
  }
}

// ─── Metadata-pollution guard ──────────────────────────────────────────────

const METADATA_RE = /\b(author|admin|group expert|all[- ]star contributor|top contributor|contributor|reply|follow|moderator|see more|active now|like|comment|share)\b/i;

/**
 * True when a candidate caption/title looks like Facebook author/admin/group
 * metadata rather than a real product description. Used to suppress garbage
 * pin titles and avoid generating a high quality score off junk text.
 *
 * Heuristic: the text contains one of the metadata "tells" (Author / Admin /
 * Group expert / All-star contributor / Reply / Follow / Like / Comment /
 * Share / etc.) AND has *none* of our product signals. Each token uses word
 * boundaries so e.g. "off" doesn't match inside "Coffee".
 */
function looksLikeMetadata(text) {
  const t = (text || '').trim();
  if (!t) return false;

  // Caption is "useful" when it mentions a product/deal signal — those
  // override the metadata heuristic so legit posts don't get nuked.
  const productSignal = /(amazon|amzn\.to|a\.co|#ad|\bcoupon\b|\bcode\b|price drop|lightning|prime|\bdeal\b|\bsale\b|\boff\b|\bdiscount\b)/i;
  if (productSignal.test(t)) return false;

  // Pure metadata-looking text that has none of the product signals is
  // treated as polluted. The regex hits the worst offenders we've seen
  // in production screenshots.
  return METADATA_RE.test(t);
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
    setCapValue(els.capAffiliate, 'Manual link set', 'ok');
  } else if (n === 0 && !els.manualAmazonUrl.value.trim()) {
    setCapValue(els.capAffiliate, 'Paste affiliate URL', 'warn');
  } else {
    setCapValue(els.capAffiliate, 'Pending manual URL', 'warn');
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

/**
 * True when the given URL belongs to a Facebook host we support.
 * Accepts: facebook.com, www.facebook.com, m.facebook.com, web.facebook.com.
 * Robust against trailing paths, query strings, and port numbers.
 */
function isFacebookUrl(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'facebook.com' || host.endsWith('.facebook.com');
}

/**
 * Try to inject content.js + content.css into the active tab if the content
 * script isn't responding. Used as a runtime fallback when the manifest
 * registration didn't take effect (e.g. extension was just reloaded).
 *
 * Returns true on success, false otherwise.
 */
async function injectContentScript(tabId) {
  if (!chrome.scripting || !chrome.scripting.executeScript) return false;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: false },
      files:  ['content.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files:  ['content.js'],
    });
    return true;
  } catch (e) {
    console.warn('[AffiliatePin] manual content-script injection failed:', e);
    return false;
  }
}

/**
 * Ping the content script. Returns true if it answers within 600ms.
 */
async function pingContentScript(tabId) {
  try {
    const resp = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'ping' }),
      new Promise(resolve => setTimeout(() => resolve(null), 600)),
    ]);
    return !!(resp && resp.success);
  } catch {
    return false;
  }
}

/**
 * Show the "not Facebook" / "content script not responding" empty state.
 * mode: 'not-facebook' | 'no-content-script' | 'no-tab-url'
 */
function showEmptyState(mode, extraMsg) {
  els.loading.classList.add('hidden');
  els.mainContent.classList.add('hidden');
  els.notFacebook.classList.remove('hidden');

  const headline = els.notFacebookHeadline;
  const detail   = els.notFacebookDetail;
  const inject   = els.btnInjectHelper;

  if (mode === 'no-content-script') {
    if (headline) headline.textContent = 'Facebook detected, but content script is not active.';
    if (detail)   detail.textContent   = 'Click below to inject the helper, or refresh the Facebook tab and reopen the popup.';
    if (inject)   inject.classList.remove('hidden');
  } else if (mode === 'no-tab-url') {
    if (headline) headline.textContent = 'Cannot access this tab.';
    if (detail)   detail.textContent   = extraMsg || 'Refresh the Facebook page and try again.';
    if (inject)   inject.classList.add('hidden');
  } else {
    if (headline) headline.textContent = 'Open a Facebook page to use this extension.';
    if (detail)   detail.textContent   = 'Works on facebook.com, www.facebook.com, m.facebook.com, and web.facebook.com (groups, pages, posts, photos).';
    if (inject)   inject.classList.add('hidden');
  }
}

async function init() {
  // Bind always-on events first so Options/Refresh work even when the popup
  // can't reach the active tab or the user isn't on Facebook.
  bindAlwaysOnEvents();

  // Load settings
  const stored = await chrome.storage.local.get([
    'associateTag', 'hoverButtonsEnabled', 'defaultBoard', 'defaultDisclosure',
    'defaultPriceDisclaimer', 'defaultCategory', 'facebookOnlyMode',
    'qualityWarningsEnabled',
  ]);
  state.settings    = stored;
  state.associateTag = (stored.associateTag || '').trim();
  state.qualityWarningsEnabled = stored.qualityWarningsEnabled !== false;

  // Load saved templates (or defaults).
  try {
    state.templates = await getSavedTemplates();
  } catch (e) {
    console.warn('[AffiliatePin] templates load failed:', e);
    state.templates = getDefaultTemplates();
  }

  // Check if on Facebook
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url   = tab?.url || '';

  if (!tab || !url) {
    showEmptyState('no-tab-url');
    return;
  }

  if (!isFacebookUrl(url)) {
    showEmptyState('not-facebook');
    return;
  }

  // We're on Facebook. Make sure the content script is responding;
  // if not, fall back to chrome.scripting injection.
  let alive = await pingContentScript(tab.id);
  if (!alive) {
    const injected = await injectContentScript(tab.id);
    if (injected) {
      // Give the content script a moment to register its message listener.
      await new Promise(r => setTimeout(r, 100));
      alive = await pingContentScript(tab.id);
    }
  }
  if (!alive) {
    state.sourceFacebookUrl = url;
    state.lastTabId = tab.id;
    showEmptyState('no-content-script');
    return;
  }

  state.sourceFacebookUrl = url;
  state.lastTabId = tab.id;

  // Show / hide the setup-warning card based on Associate tag presence.
  if (els.setupWarning) {
    if (!state.associateTag) {
      _show(els.setupWarning);
    } else {
      _hide(els.setupWarning);
    }
  }

  // Wire up always-on workflow handlers (Start screen buttons, change-image,
  // copy buttons, etc.) before deciding which view to show.
  bindEvents(tab.id);

  // ── Quick-capture support ───────────────────────────────────────────────
  // Phase 2 hover-click flow stores the clicked image URL + nearby post
  // caption + Amazon URLs into chrome.storage.session.quickCapture. We
  // consume it here, populate state, and clear it so it isn't reused.
  const session  = await chrome.storage.session.get(['quickCapture', 'hoverSelectedSrc']);
  const quickCap = session.quickCapture || null;
  await chrome.storage.session.remove(['quickCapture', 'hoverSelectedSrc']);

  setLoading(false);

  if (quickCap && quickCap.singleImage && (quickCap.selectedImageUrl || quickCap.src)) {
    // Single-image quick capture flow — use ONLY the clicked image, do not
    // run a full page image scan, do not populate the picker gallery.
    await applyQuickCapture(quickCap);
    return;
  }

  // No quick-capture handoff → user opened the popup directly. Show the
  // clean "Start a Pin" card; do not auto-scan the page.
  state.source        = 'picker';
  state.containerKind = null;
  showStartScreen();
}

/**
 * Single-image flow when the user clicked the on-page hover button. We hand
 * the captured payload straight into the popup state and render the working
 * UI without ever invoking scanPage(), so the user only ever sees the image
 * they clicked on (no gallery, no random page images).
 */
async function applyQuickCapture(quickCap) {
  const quickSrc = quickCap.selectedImageUrl || quickCap.src || '';
  state.quickCapture  = quickCap;
  state.caption       = quickCap.caption || '';
  state.amazonUrls    = Array.isArray(quickCap.amazonUrls) ? quickCap.amazonUrls : [];
  state.source        = 'quick-capture';
  state.containerKind = quickCap.containerKind || null;
  state.images        = []; // never populate gallery from quick capture

  // Show working sections (preview + amazon + caption + actions). Pinterest
  // content + quality reveal automatically once we have caption/Amazon.
  showWorkingSections();
  _hide(els.imagePickerSection);
  _show(els.quickCaptureHint);

  // Render the single selected image in the preview without touching the
  // picker gallery.
  selectImage({ src: quickSrc }, { reextractCaption: false });
  renderCaptionPreview();
  renderAmazonLinks();

  if (state.amazonUrls.length > 0) {
    await selectAmazonUrl(state.amazonUrls[0]);
  } else {
    regeneratePinterestContent();
  }
  await maybeAutoLaunchOneClick();
}

async function maybeAutoLaunchOneClick() {
  if (state.source !== 'quick-capture') return;
  const hasImage = !!state.selectedSrc;
  const hasCaption = !!(state.caption || '').trim();
  const hasAmazon = !!state.selectedAmazon;
  const hasTag = !!(state.associateTag || '').trim();
  const hasAffiliate = !!(state.affiliateUrl || '').trim();
  if (!(hasImage && hasCaption && hasAmazon && hasTag && hasAffiliate)) return;
  openPinterest();
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

    // Reveal the working UI now that we have content to render.
    showWorkingSections();
    _show(els.imagePickerSection);
    if (state.quickCapture && state.quickCapture.src) {
      _show(els.quickCaptureHint);
    } else {
      _hide(els.quickCaptureHint);
    }

    renderImageGrid(preferSrc);
    renderAmazonLinks();
    renderCaptionPreview();

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
  const manual = (rawUrl || '').trim();
  state.affiliateUrl = manual || null;
  state.affiliateWarn = null;
  els.affiliateUrl.value = manual;
  if (!manual) showWarning('Paste your final Amazon affiliate link manually.');
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

  // ── Metadata-pollution guard ────────────────────────────────────────────
  // If the caption is dominated by Facebook author/admin/group metadata
  // (no Amazon URL, no #ad, no deal language) AND the parser produced a
  // title that looks like that metadata, suppress the auto-generated copy
  // entirely. We never want to render "Milena MiticAuthorAdmin…" as a
  // Pinterest title — and we never want to flash a 97/100 quality badge
  // next to it. The user can edit the caption to recover.
  const captionPolluted = looksLikeMetadata(state.caption);
  const titlePolluted   = looksLikeMetadata(pinterestTitle);
  const polluted        = captionPolluted || titlePolluted;

  if (polluted) {
    els.pinTitle.value       = '';
    els.pinDesc.value        = '';
    els.pinHashtags.value    = '';
    els.pinAlt.value         = '';
    els.couponCode.value     = '';
    els.suggestedBoard.value = '';
    els.taggedTopics.value   = '';
    if (els.pinEmptyHint) {
      els.pinEmptyHint.textContent =
        'Paste or edit the caption below to generate pin content. The detected text looks like Facebook metadata, not a product description.';
      _show(els.pinEmptyHint);
    }
    // Wipe parsed so quality scoring sees an empty package and reports a
    // realistic (low) score instead of 97/100 from junk.
    state.parsed = {};
  } else {
    els.pinTitle.value       = pinterestTitle       || '';
    els.pinDesc.value        = pinterestDescription || '';
    els.pinHashtags.value    = hashtags             || '';
    els.pinAlt.value         = altText              || '';
    els.couponCode.value     = couponCode           || '';
    els.suggestedBoard.value = suggestedBoard       || 'Amazon Finds & Daily Deals';
    els.taggedTopics.value   = Array.isArray(taggedTopics) ? taggedTopics.join(', ') : '';
    _hide(els.pinEmptyHint);
  }

  updateCharCounts();
  updateCaptureStatus();
  updateQualityUI();
  applyProgressiveDisclosure();
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

/**
 * Open the Options page using the official API, falling back to opening it
 * as a tab when openOptionsPage isn't available (e.g. older Chrome builds).
 */
function openOptions() {
  if (chrome.runtime && chrome.runtime.openOptionsPage) {
    try {
      chrome.runtime.openOptionsPage();
      return;
    } catch (e) {
      console.warn('[AffiliatePin] openOptionsPage failed, falling back:', e);
    }
  }
  if (chrome.tabs && chrome.tabs.create && chrome.runtime && chrome.runtime.getURL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
}

/**
 * Always-on bindings — these are wired up before Facebook detection so the
 * Options button (and the diagnostic Inject button) work even when the popup
 * is showing the empty state.
 */
function bindAlwaysOnEvents() {
  if (els.btnOptions && !els.btnOptions.dataset.bound) {
    els.btnOptions.dataset.bound = '1';
    els.btnOptions.addEventListener('click', openOptions);
  }

  if (els.btnInjectHelper && !els.btnInjectHelper.dataset.bound) {
    els.btnInjectHelper.dataset.bound = '1';
    els.btnInjectHelper.addEventListener('click', async () => {
      const tabId = state.lastTabId;
      if (!tabId) {
        showStatus('No active Facebook tab found.', 'error');
        return;
      }
      els.btnInjectHelper.disabled = true;
      els.btnInjectHelper.textContent = 'Injecting…';
      const ok = await injectContentScript(tabId);
      if (ok) {
        // Give content.js a beat to register listeners before reload.
        await new Promise(r => setTimeout(r, 120));
        const alive = await pingContentScript(tabId);
        if (alive) {
          // Re-run init now that the content script is responsive.
          els.notFacebook.classList.add('hidden');
          els.btnInjectHelper.classList.add('hidden');
          els.btnInjectHelper.disabled = false;
          els.btnInjectHelper.textContent = 'Inject / Reload Extension Helper';
          init();
          return;
        }
      }
      els.btnInjectHelper.disabled = false;
      els.btnInjectHelper.textContent = 'Inject / Reload Extension Helper';
      showStatus('Could not inject helper. Refresh the Facebook tab and try again.', 'error');
    });
  }
}

function bindEvents(tabId) {
  state.lastTabId = tabId;

  // bindEvents() is now called early (before applyQuickCapture) and may run
  // again after the user clicks "Scan Page Images". Skip the second call so
  // we don't stack duplicate listeners.
  if (state._eventsBound) return;
  state._eventsBound = true;

  // Start screen — Scan Page Images
  if (els.btnScanPage) {
    els.btnScanPage.addEventListener('click', () => {
      showStatus('Gallery scanning is disabled. Use Pin Affiliate hover capture and paste your final affiliate link manually.', 'info');
    });
  }

  // Start screen — Paste Amazon URL Manually
  if (els.btnPasteAmazon) {
    els.btnPasteAmazon.addEventListener('click', () => {
      showManualEntry();
    });
  }

  // Start screen + setup warning — Open Options shortcuts
  if (els.btnStartOptions) {
    els.btnStartOptions.addEventListener('click', openOptions);
  }
  if (els.btnSetupOptions) {
    els.btnSetupOptions.addEventListener('click', openOptions);
  }

  els.btnRefresh.addEventListener('click', () => {
    showStatus('Gallery scanning is disabled in manual-link mode.', 'info');
  });

  // Manual Amazon URL — Phase 2.1 fallback when Facebook detection fails.
  // Switches the source label to 'manual' so Capture Status shows the
  // user is overriding.
  els.manualAmazonUrl.addEventListener('change', async () => {
    const val = els.manualAmazonUrl.value.trim();
    if (!val) return;
    state.source = 'manual';
    await resolveAndConvert(val);
    applyProgressiveDisclosure();
  });
  els.manualAmazonUrl.addEventListener('input', () => {
    applyProgressiveDisclosure();
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
    applyProgressiveDisclosure();
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
  els.pinTitle.addEventListener('input', () => {
    updateCharCounts();
    updateQualityUI();
  });
  els.pinDesc.addEventListener('input', () => {
    updateCharCounts();
    if (state.parsed) state.parsed.pinterestDescription = els.pinDesc.value;
    updateQualityUI();
  });
  els.pinHashtags.addEventListener('input', () => {
    if (state.parsed) state.parsed.hashtags = els.pinHashtags.value;
    updateQualityUI();
  });
  els.pinAlt.addEventListener('input', () => {
    if (state.parsed) state.parsed.altText = els.pinAlt.value;
    updateQualityUI();
  });
  els.suggestedBoard.addEventListener('input', updateQualityUI);
  els.taggedTopics.addEventListener('input', updateQualityUI);

  // Phase 4 — Auto-Fix button.
  if (els.btnAutoFix) {
    els.btnAutoFix.addEventListener('click', () => applyAutoFixToFields(true));
  }

  // Phase 4 — Quality save-warning modal buttons.
  if (els.btnQualCancel)  els.btnQualCancel .addEventListener('click', closeQualModal);
  if (els.btnQualAutofix) els.btnQualAutofix.addEventListener('click', () => {
    applyAutoFixToFields(true);
    closeQualModal();
  });
  if (els.btnQualSave)    els.btnQualSave   .addEventListener('click', () => {
    closeQualModal();
    trySaveCurrentToQueue(false, /*skipQualityCheck=*/true);
  });
  document.querySelectorAll('#qual-modal [data-close-qual]').forEach(el => {
    el.addEventListener('click', closeQualModal);
  });

  // Change image — fall back to the picker. If we haven't scanned the page
  // yet (quick-capture flow stays single-image until the user explicitly
  // asks for alternatives), trigger a scan now so the gallery is populated.
  if (els.btnChangeImage) {
    els.btnChangeImage.addEventListener('click', () => {
      showStatus('Image gallery is removed. Capture the correct image using Pin Affiliate hover on Facebook.', 'info');
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

  // ── Phase 3: Save to Queue / Open Queue ──────────────────────────────────
  if (els.btnSaveQueue) {
    els.btnSaveQueue.addEventListener('click', () => trySaveCurrentToQueue(false));
  }
  if (els.btnOpenQueue) {
    els.btnOpenQueue.addEventListener('click', openQueueDashboard);
  }

  // Duplicate-warning modal
  if (els.btnDupCancel) els.btnDupCancel.addEventListener('click', closeDupModal);
  if (els.btnDupSave)   els.btnDupSave  .addEventListener('click', () => {
    closeDupModal();
    trySaveCurrentToQueue(true);
  });
  if (els.btnDupView)   els.btnDupView  .addEventListener('click', () => {
    closeDupModal();
    openQueueDashboard();
  });
  document.querySelectorAll('#dup-modal [data-close-dup]').forEach(el => {
    el.addEventListener('click', closeDupModal);
  });
}

// ─── Phase 3 queue helpers ─────────────────────────────────────────────────

function buildQueuePayloadFromState() {
  const parsed = state.parsed || {};
  return {
    productTitle:         parsed.productTitle         || '',
    pinterestTitle:       (els.pinTitle && els.pinTitle.value.trim())       || parsed.pinterestTitle       || '',
    pinterestDescription: (els.pinDesc  && els.pinDesc.value.trim())        || parsed.pinterestDescription || '',
    hashtags:             (els.pinHashtags && els.pinHashtags.value.trim())|| parsed.hashtags             || '',
    suggestedBoard:       (els.suggestedBoard && els.suggestedBoard.value.trim()) || parsed.suggestedBoard || '',
    taggedTopics:         (els.taggedTopics && els.taggedTopics.value.trim()) || (Array.isArray(parsed.taggedTopics) ? parsed.taggedTopics.join(', ') : ''),
    altText:              (els.pinAlt && els.pinAlt.value.trim())          || parsed.altText             || '',
    facebookCaption:      (els.captionPreview && els.captionPreview.value) || state.caption              || '',
    sourceFacebookUrl:    state.sourceFacebookUrl || '',
    selectedImageUrl:     state.selectedSrc      || '',
    amazonUrl:            state.selectedAmazon
                         || (state.amazonUrls && state.amazonUrls[0])
                         || (els.manualAmazonUrl && els.manualAmazonUrl.value.trim())
                         || '',
    affiliateUrl:         state.affiliateUrl     || (els.affiliateUrl && els.affiliateUrl.value.trim()) || '',
    couponCode:           parsed.couponCode      || (els.couponCode && els.couponCode.value.trim()) || '',
    dealType:             parsed.dealType        || '',
  };
}

async function trySaveCurrentToQueue(allowDuplicate, skipQualityCheck) {
  const payload = buildQueuePayloadFromState();

  // Minimal validation — image is the only hard requirement; everything
  // else can be edited in the queue dashboard.
  if (!payload.selectedImageUrl) {
    showStatus('Pick an image before saving to queue.', 'warning');
    return;
  }
  if (!payload.pinterestTitle && !payload.productTitle) {
    showStatus('Generate a Pin Package first (click Re-generate).', 'warning');
    return;
  }

  // Phase 4 — warn before saving low-quality pins (when the user has
  // quality warnings enabled, default on).
  if (!skipQualityCheck && state.qualityWarningsEnabled !== false) {
    const score = scorePinPackage(payload);
    if (score < QUALITY_NEEDS_REVIEW_THRESHOLD) {
      openQualModal(payload);
      return;
    }
  }

  try {
    const result = await saveQueueItem(payload, { allowDuplicate });
    if (result.saved) {
      showStatus('Saved to queue.', 'success');
      return;
    }
    if (result.duplicate) {
      openDupModal(result.duplicate);
    }
  } catch (e) {
    console.error('[AffiliatePin] queue save failed:', e);
    showStatus('Could not save to queue: ' + e.message, 'error');
  }
}

function openDupModal(existing) {
  const title  = existing.pinterestTitle || existing.productTitle || '(untitled pin)';
  const when   = existing.createdAt ? new Date(existing.createdAt).toLocaleString() : '';
  els.dupExisting.textContent = `Existing: "${title}"${when ? ' — saved ' + when : ''}.`;
  els.dupModal.classList.remove('hidden');
}

function closeDupModal() {
  els.dupModal.classList.add('hidden');
}

// ─── Phase 4: Pin Quality UI ───────────────────────────────────────────────

function _activeTemplate() {
  if (!state.templates || typeof getTemplateForCategory !== 'function') return null;
  const cat = (state.parsed && state.parsed.category)
           || (state.settings && state.settings.defaultCategory)
           || 'default';
  return getTemplateForCategory(cat, state.templates);
}

function updateQualityUI() {
  if (!els.qualityBadge) return;
  if (state.qualityWarningsEnabled === false) {
    els.qualitySection && els.qualitySection.classList.add('hidden');
    return;
  }
  els.qualitySection && els.qualitySection.classList.remove('hidden');

  const payload = buildQueuePayloadFromState();
  const score    = scorePinPackage(payload);
  const warnings = getQualityWarnings(payload);

  els.qualityBadge.textContent = `${score}/100`;
  els.qualityBadge.className   = 'aps-quality-badge ' + (
    score >= QUALITY_GOOD_THRESHOLD ? 'good' :
    score >= QUALITY_NEEDS_REVIEW_THRESHOLD ? 'warn' : 'bad'
  );

  els.qualityWarnings.innerHTML = '';
  for (const w of warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    els.qualityWarnings.appendChild(li);
  }
}

function applyAutoFixToFields(showStatusToast) {
  const payload = buildQueuePayloadFromState();
  const template = _activeTemplate();

  // Use the existing alt-text generator when available so generated alt
  // text matches the rest of the extension's tone.
  const altGen = (typeof generateAltText === 'function' && state.parsed)
    ? (pin) => generateAltText(
        pin.productTitle || state.parsed.productTitle || '',
        {
          category:       (state.parsed && state.parsed.category)       || 'general',
          suggestedBoard: (state.parsed && state.parsed.suggestedBoard) || '',
          taggedTopics:   (state.parsed && state.parsed.taggedTopics)   || [],
          hashtags:       (state.parsed && state.parsed.hashtags)       || '',
          useCases:       (template && template.useCases)               || ['everyday use'],
          seoPhrase:      (state.parsed && state.parsed.seoPhrase)      || '',
        },
        state.caption || ''
      )
    : null;

  let fixed = autoFixPinPackage(payload, { template, altGenerator: altGen });

  // Then layer template defaults for any *still*-empty fields (board,
  // topics, etc).
  if (template) fixed = applyTemplateToPin(fixed, template);

  // Push back into the form.
  if (els.pinTitle)       els.pinTitle.value       = fixed.pinterestTitle       || els.pinTitle.value;
  if (els.pinDesc)        els.pinDesc.value        = fixed.pinterestDescription || els.pinDesc.value;
  if (els.pinHashtags)    els.pinHashtags.value    = fixed.hashtags             || els.pinHashtags.value;
  if (els.suggestedBoard) els.suggestedBoard.value = fixed.suggestedBoard       || els.suggestedBoard.value;
  if (els.taggedTopics)   els.taggedTopics.value   = fixed.taggedTopics         || els.taggedTopics.value;
  if (els.pinAlt)         els.pinAlt.value         = fixed.altText              || els.pinAlt.value;

  // Keep state.parsed in sync with the visible fields.
  if (state.parsed) {
    state.parsed.pinterestTitle       = els.pinTitle.value;
    state.parsed.pinterestDescription = els.pinDesc.value;
    state.parsed.hashtags             = els.pinHashtags.value;
    state.parsed.suggestedBoard       = els.suggestedBoard.value;
    state.parsed.taggedTopics         = els.taggedTopics.value;
    state.parsed.altText              = els.pinAlt.value;
  }

  updateCharCounts();
  updateQualityUI();
  if (showStatusToast) showStatus('Auto-Fix applied to pin copy.', 'success');
}

function openQualModal(payload) {
  const warnings = getQualityWarnings(payload || buildQueuePayloadFromState());
  if (els.qualWarnings) {
    els.qualWarnings.innerHTML = '';
    for (const w of warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      els.qualWarnings.appendChild(li);
    }
  }
  if (els.qualMessage) {
    els.qualMessage.textContent = 'This pin has quality warnings. Save anyway?';
  }
  if (els.qualModal) els.qualModal.classList.remove('hidden');
}

function closeQualModal() {
  if (els.qualModal) els.qualModal.classList.add('hidden');
}

function openQueueDashboard() {
  const url = chrome.runtime.getURL('queue.html');
  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url, active: true });
  } else {
    chrome.runtime.sendMessage({ action: 'openTab', url });
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

init().catch(e => {
  console.error('[AffiliatePin] Init error:', e);
  els.loading.classList.add('hidden');
  els.mainContent.classList.remove('hidden');
  showStatus('Extension error: ' + e.message, 'error');
});
