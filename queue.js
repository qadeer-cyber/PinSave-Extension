/**
 * queue.js — Affiliate Pin Saver, Phase 3 batch queue dashboard.
 *
 * Renders the queue stored in chrome.storage.local (via utils/queue.js)
 * and lets the user open Pinterest one item at a time, copy the full pin
 * package, edit fields, mark posted/skipped, delete, export CSV, or clear.
 *
 * No network calls. No analytics. Manual publish only.
 */

'use strict';

// ─── State ─────────────────────────────────────────────────────────────────

let allItems     = [];
let editingId    = null;
let confirmCb    = null;
let templatesMap = null; // Loaded lazily from utils/templates.js.

// ─── DOM refs ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  statusBar:        $('status-bar'),

  // Summary
  sumTotal:         $('sum-total'),
  sumDraft:         $('sum-draft'),
  sumOpened:        $('sum-opened'),
  sumPosted:        $('sum-posted'),
  sumSkipped:       $('sum-skipped'),
  sumToday:         $('sum-today'),

  // Filters
  filterSearch:     $('filter-search'),
  filterStatus:     $('filter-status'),
  filterBoard:      $('filter-board'),
  filterSort:       $('filter-sort'),
  filterQuality:    $('filter-quality'),

  // Grid + empty
  grid:             $('queue-grid'),
  emptyMsg:         $('empty-msg'),

  // Header buttons
  btnExportCsv:     $('btn-export-csv'),
  btnClearPosted:   $('btn-clear-posted'),
  btnClearAll:      $('btn-clear-all'),
  btnAutofixAll:    $('btn-autofix-all'),

  // Edit modal
  editModal:        $('edit-modal'),
  editPinTitle:     $('edit-pin-title'),
  editPinDesc:      $('edit-pin-description'),
  editHashtags:     $('edit-hashtags'),
  editBoard:        $('edit-board'),
  editTopics:       $('edit-topics'),
  editAlt:          $('edit-alt'),
  editAffiliate:    $('edit-affiliate'),
  editCaption:      $('edit-caption'),
  btnEditCancel:    $('btn-edit-cancel'),
  btnEditSave:      $('btn-edit-save'),

  // Confirm modal
  confirmModal:     $('confirm-modal'),
  confirmTitle:     $('confirm-title'),
  confirmMessage:   $('confirm-message'),
  btnConfirmOk:     $('btn-confirm-ok'),
  btnConfirmCancel: $('btn-confirm-cancel'),
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function showStatus(msg, type = 'info', timeoutMs = 3500) {
  els.statusBar.textContent = msg;
  els.statusBar.className = `aps-q-status ${type}`;
  els.statusBar.classList.remove('hidden');
  if (timeoutMs > 0) {
    setTimeout(() => els.statusBar.classList.add('hidden'), timeoutMs);
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function copyToClipboard(text, label) {
  if (!text) {
    showStatus(`Nothing to copy for ${label}.`, 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showStatus(`${label} copied to clipboard.`, 'success', 2000);
  } catch {
    showStatus('Could not copy. Please copy manually.', 'error');
  }
}

function buildFullPinPackageFromItem(it) {
  return [
    'Title:',         it.pinterestTitle || '',           '',
    'Description:',   it.pinterestDescription || '',     '',
    'Hashtags:',      it.hashtags || '',                 '',
    'Board:',         it.suggestedBoard || '',           '',
    'Tagged Topics:', it.taggedTopics || '',             '',
    'Alt Text:',      it.altText || '',                  '',
    'Affiliate Link:', it.affiliateUrl || '',
  ].join('\n');
}

// ─── Confirm modal ─────────────────────────────────────────────────────────

function openConfirm({ title, message, okLabel = 'Confirm', okClass = 'aps-q-btn-danger' }, onOk) {
  els.confirmTitle.textContent   = title;
  els.confirmMessage.textContent = message;
  els.btnConfirmOk.textContent   = okLabel;
  els.btnConfirmOk.className     = `aps-q-btn ${okClass}`;
  confirmCb = onOk;
  els.confirmModal.classList.remove('hidden');
}

function closeConfirm() {
  els.confirmModal.classList.add('hidden');
  confirmCb = null;
}

// ─── Edit modal ────────────────────────────────────────────────────────────

function openEditModal(item) {
  editingId = item.id;
  els.editPinTitle.value    = item.pinterestTitle       || '';
  els.editPinDesc.value     = item.pinterestDescription || '';
  els.editHashtags.value    = item.hashtags             || '';
  els.editBoard.value       = item.suggestedBoard       || '';
  els.editTopics.value      = item.taggedTopics         || '';
  els.editAlt.value         = item.altText              || '';
  els.editAffiliate.value   = item.affiliateUrl         || '';
  els.editCaption.value     = item.facebookCaption      || '';
  els.editModal.classList.remove('hidden');
  els.editPinTitle.focus();
}

function closeEditModal() {
  els.editModal.classList.add('hidden');
  editingId = null;
}

async function saveEdit() {
  if (!editingId) return;
  const updates = {
    pinterestTitle:       els.editPinTitle.value.trim(),
    pinterestDescription: els.editPinDesc.value.trim(),
    hashtags:             els.editHashtags.value.trim(),
    suggestedBoard:       els.editBoard.value.trim(),
    taggedTopics:         els.editTopics.value.trim(),
    altText:              els.editAlt.value.trim(),
    affiliateUrl:         els.editAffiliate.value.trim(),
    facebookCaption:      els.editCaption.value,
  };
  await updateQueueItem(editingId, updates);
  closeEditModal();
  await render();
  showStatus('Pin updated.', 'success');
}

// ─── Render ────────────────────────────────────────────────────────────────

function applyFiltersAndSort(items) {
  const q        = (els.filterSearch.value || '').trim().toLowerCase();
  const status   = els.filterStatus.value;
  const board    = els.filterBoard.value;
  const sort     = els.filterSort.value;
  const quality  = els.filterQuality ? els.filterQuality.value : 'all';

  let out = items.slice();

  if (q) {
    out = out.filter(it => {
      const hay = [
        it.pinterestTitle, it.productTitle, it.suggestedBoard,
        it.taggedTopics,   it.facebookCaption, it.asin, it.amazonUrl, it.affiliateUrl,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  if (status && status !== 'all') {
    out = out.filter(it => it.status === status);
  }
  if (board && board !== 'all') {
    out = out.filter(it => (it.suggestedBoard || '') === board);
  }

  // Phase 4 — Quality filter.
  if (quality && quality !== 'all') {
    out = out.filter(it => {
      const score    = scorePinPackage(it);
      const warnings = getQualityWarnings(it);
      switch (quality) {
        case 'ready':              return score >= QUALITY_GOOD_THRESHOLD;
        case 'needs-review':       return score < QUALITY_GOOD_THRESHOLD;
        case 'missing-affiliate':  return warnings.includes('Missing affiliate link') ||
                                          warnings.includes('Affiliate link does not include tag=');
        case 'missing-disclosure': return warnings.includes('Missing affiliate disclosure');
        default:                   return true;
      }
    });
  }

  switch (sort) {
    case 'oldest': out.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
    case 'board':  out.sort((a, b) => (a.suggestedBoard || '').localeCompare(b.suggestedBoard || '')); break;
    case 'status': {
      const order = { draft: 0, opened: 1, posted: 2, skipped: 3 };
      out.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      break;
    }
    case 'newest':
    default:       out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return out;
}

function renderSummary(items) {
  const s = summarizeQueue(items);
  els.sumTotal.textContent   = s.total;
  els.sumDraft.textContent   = s.draft;
  els.sumOpened.textContent  = s.opened;
  els.sumPosted.textContent  = s.posted;
  els.sumSkipped.textContent = s.skipped;
  els.sumToday.textContent   = s.capturedToday;
}

function renderBoardFilter(items) {
  const boards = Array.from(new Set(items.map(it => it.suggestedBoard).filter(Boolean))).sort();
  const current = els.filterBoard.value;
  els.filterBoard.innerHTML = '<option value="all">All boards</option>';
  for (const b of boards) {
    const opt = document.createElement('option');
    opt.value       = b;
    opt.textContent = b;
    if (b === current) opt.selected = true;
    els.filterBoard.appendChild(opt);
  }
}

function renderItem(item) {
  const card = document.createElement('article');
  card.className   = 'aps-q-item';
  card.dataset.id  = item.id;

  // ── thumbnail ──
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'aps-q-item-thumb-wrap';

  const badge = document.createElement('span');
  badge.className   = `aps-q-status-badge ${item.status}`;
  badge.textContent = item.status;
  thumbWrap.appendChild(badge);

  if (item.selectedImageUrl) {
    const img = document.createElement('img');
    img.className = 'aps-q-item-thumb';
    img.alt       = item.pinterestTitle || 'Pin image';
    img.loading   = 'lazy';
    img.src       = item.selectedImageUrl;
    img.addEventListener('error', () => {
      img.remove();
      const ph = document.createElement('div');
      ph.className   = 'aps-q-item-thumb-missing';
      ph.textContent = 'Image failed to load';
      thumbWrap.appendChild(ph);
    });
    thumbWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className   = 'aps-q-item-thumb-missing';
    ph.textContent = 'No image';
    thumbWrap.appendChild(ph);
  }

  // Phase 4 — Quality badge overlay (top-right corner of the thumb).
  const score   = scorePinPackage(item);
  const qBadge  = document.createElement('span');
  qBadge.className   = 'aps-q-quality-badge ' + (
    score >= QUALITY_GOOD_THRESHOLD ? 'good' :
    score >= QUALITY_NEEDS_REVIEW_THRESHOLD ? 'warn' : 'bad'
  );
  qBadge.textContent = `${score}/100`;
  qBadge.title       = `Pin Quality Score: ${score}/100`;
  thumbWrap.appendChild(qBadge);

  card.appendChild(thumbWrap);

  // ── body ──
  const body = document.createElement('div');
  body.className = 'aps-q-item-body';

  const title = document.createElement('div');
  title.className   = 'aps-q-item-title';
  title.textContent = item.pinterestTitle || item.productTitle || '(untitled)';
  body.appendChild(title);

  if (item.suggestedBoard) {
    const board = document.createElement('div');
    board.className   = 'aps-q-item-board';
    board.textContent = item.suggestedBoard;
    body.appendChild(board);
  }

  const meta = document.createElement('div');
  meta.className = 'aps-q-item-meta';
  const metaParts = [];
  metaParts.push(`Saved ${escapeHtml(fmtDate(item.createdAt))}`);
  if (item.couponCode)        metaParts.push(`Coupon: <strong>${escapeHtml(item.couponCode)}</strong>`);
  if (item.dealType)          metaParts.push(`Deal: <strong>${escapeHtml(item.dealType)}</strong>`);
  if (item.asin)              metaParts.push(`ASIN: <code>${escapeHtml(item.asin)}</code>`);
  if (item.affiliateUrl)      metaParts.push(`<a href="${escapeHtml(item.affiliateUrl)}" target="_blank" rel="noopener noreferrer">Affiliate ↗</a>`);
  if (item.sourceFacebookUrl) metaParts.push(`<a href="${escapeHtml(item.sourceFacebookUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`);
  meta.innerHTML = metaParts.join(' · ');
  body.appendChild(meta);

  // Phase 4 — inline warning list per item.
  const warnings = getQualityWarnings(item);
  if (warnings.length) {
    const ul = document.createElement('ul');
    ul.className = 'aps-q-item-warnings';
    for (const w of warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  card.appendChild(body);

  // ── actions ──
  const actions = document.createElement('div');
  actions.className = 'aps-q-item-actions';

  const btn = (label, cls, onClick, opts = {}) => {
    const b = document.createElement('button');
    b.className   = `aps-q-btn ${cls}` + (opts.wide ? ' aps-q-item-actions-wide' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  actions.appendChild(btn('Open Pinterest',    'aps-q-btn-primary',   () => openPinterestForItem(item),       { wide: true }));
  actions.appendChild(btn('Copy Full Package', 'aps-q-btn-secondary', () => copyToClipboard(buildFullPinPackageFromItem(item), 'Full Pin Package')));
  actions.appendChild(btn('Copy Affiliate',    'aps-q-btn-secondary', () => copyToClipboard(item.affiliateUrl || '', 'Affiliate link')));
  actions.appendChild(btn('Auto-Fix',          'aps-q-btn-secondary', () => autoFixItem(item.id)));
  actions.appendChild(btn('Edit',              'aps-q-btn-secondary', () => openEditModal(item)));
  actions.appendChild(btn('Mark Posted',       'aps-q-btn-secondary', () => markStatus(item.id, 'posted')));
  if (item.status !== 'skipped') {
    actions.appendChild(btn('Skip',            'aps-q-btn-secondary', () => markStatus(item.id, 'skipped')));
  } else {
    actions.appendChild(btn('Reopen',          'aps-q-btn-secondary', () => markStatus(item.id, 'draft')));
  }
  actions.appendChild(btn('Delete',            'aps-q-btn-danger',    () => confirmDelete(item), { wide: true }));

  card.appendChild(actions);
  return card;
}

async function render() {
  allItems = await getQueue();

  renderSummary(allItems);
  renderBoardFilter(allItems);

  const filtered = applyFiltersAndSort(allItems);

  els.grid.innerHTML = '';
  if (allItems.length === 0) {
    els.emptyMsg.classList.remove('hidden');
    return;
  }
  els.emptyMsg.classList.add('hidden');

  if (filtered.length === 0) {
    const note = document.createElement('p');
    note.className   = 'aps-q-empty';
    note.textContent = 'No items match your filters.';
    els.grid.appendChild(note);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of filtered) frag.appendChild(renderItem(item));
  els.grid.appendChild(frag);
}

// ─── Phase 4: Auto-Fix helpers ─────────────────────────────────────────────

async function ensureTemplatesLoaded() {
  if (templatesMap) return templatesMap;
  if (typeof getSavedTemplates !== 'function') {
    templatesMap = (typeof getDefaultTemplates === 'function') ? getDefaultTemplates() : {};
    return templatesMap;
  }
  try {
    templatesMap = await getSavedTemplates();
  } catch {
    templatesMap = (typeof getDefaultTemplates === 'function') ? getDefaultTemplates() : {};
  }
  return templatesMap;
}

function _categoryForItem(item) {
  if (typeof detectProductCategory === 'function') {
    try {
      const cd = detectProductCategory(item.productTitle || '', item.facebookCaption || '');
      if (cd && cd.category) return cd.category;
    } catch { /* ignore */ }
  }
  return 'default';
}

function _altGeneratorForItem(item) {
  if (typeof generateAltText !== 'function') return null;
  return () => {
    let cd = null;
    if (typeof detectProductCategory === 'function') {
      try {
        cd = detectProductCategory(item.productTitle || '', item.facebookCaption || '');
      } catch { /* ignore */ }
    }
    return generateAltText(item.productTitle || item.pinterestTitle || '', cd, item.facebookCaption || '');
  };
}

async function autoFixItem(id) {
  const list = await getQueue();
  const item = list.find(it => it.id === id);
  if (!item) {
    showStatus('Pin not found in queue.', 'warning');
    return;
  }

  const templates = await ensureTemplatesLoaded();
  const template  = (typeof getTemplateForCategory === 'function')
    ? getTemplateForCategory(_categoryForItem(item), templates)
    : null;

  let fixed = autoFixPinPackage(item, { template, altGenerator: _altGeneratorForItem(item) });
  if (template && typeof applyTemplateToPin === 'function') {
    fixed = applyTemplateToPin(fixed, template);
  }

  await updateQueueItem(id, {
    pinterestTitle:       fixed.pinterestTitle,
    pinterestDescription: fixed.pinterestDescription,
    hashtags:             fixed.hashtags,
    suggestedBoard:       fixed.suggestedBoard,
    taggedTopics:         fixed.taggedTopics,
    altText:              fixed.altText,
  });
  await render();
  showStatus('Pin auto-fixed.', 'success');
}

async function autoFixAllDrafts() {
  const list   = await getQueue();
  const drafts = list.filter(it => it.status === 'draft');
  if (!drafts.length) {
    showStatus('No draft pins to auto-fix.', 'warning');
    return;
  }

  openConfirm({
    title:   'Auto-Fix all drafts?',
    message: `Apply auto-fix to ${drafts.length} draft pin${drafts.length === 1 ? '' : 's'}? Posted and skipped pins will not be touched.`,
    okLabel: 'Auto-Fix Drafts',
    okClass: 'aps-q-btn-primary',
  }, async () => {
    const templates = await ensureTemplatesLoaded();
    let fixedCount = 0;
    for (const it of drafts) {
      if (it.status !== 'draft') continue;

      const template = (typeof getTemplateForCategory === 'function')
        ? getTemplateForCategory(_categoryForItem(it), templates)
        : null;

      let fixed = autoFixPinPackage(it, { template, altGenerator: _altGeneratorForItem(it) });
      if (template && typeof applyTemplateToPin === 'function') {
        fixed = applyTemplateToPin(fixed, template);
      }

      await updateQueueItem(it.id, {
        pinterestTitle:       fixed.pinterestTitle,
        pinterestDescription: fixed.pinterestDescription,
        hashtags:             fixed.hashtags,
        suggestedBoard:       fixed.suggestedBoard,
        taggedTopics:         fixed.taggedTopics,
        altText:              fixed.altText,
      });
      fixedCount += 1;
    }
    closeConfirm();
    await render();
    showStatus(`Auto-fixed ${fixedCount} draft pin${fixedCount === 1 ? '' : 's'}.`, 'success');
  });
}

// ─── Item actions ──────────────────────────────────────────────────────────

async function markStatus(id, status) {
  await updateQueueItem(id, { status });
  await render();
  showStatus(`Marked as ${status}.`, 'success');
}

function confirmDelete(item) {
  openConfirm({
    title:    'Delete pin?',
    message:  `Delete "${item.pinterestTitle || item.productTitle || 'this pin'}" from your queue? This cannot be undone.`,
    okLabel:  'Delete',
    okClass:  'aps-q-btn-danger',
  }, async () => {
    await deleteQueueItem(item.id);
    closeConfirm();
    await render();
    showStatus('Pin deleted.', 'success');
  });
}

async function openPinterestForItem(item) {
  const imageUrl       = item.selectedImageUrl || '';
  const destinationUrl = item.affiliateUrl     || '';
  const description    = item.pinterestDescription || '';
  const hashtags       = item.hashtags         || '';

  if (!imageUrl) {
    showStatus('No image stored for this pin. Edit it or capture again.', 'warning');
    return;
  }
  if (!destinationUrl) {
    showStatus('No affiliate URL stored for this pin. Edit it first.', 'warning');
    return;
  }

  // Auto-copy Full Pin Package — Pinterest sometimes ignores ?description=.
  const fullPin = buildFullPinPackageFromItem(item);
  let copied = false;
  try {
    await navigator.clipboard.writeText(fullPin);
    copied = true;
  } catch { /* ignore */ }

  const url = buildPinterestCreateUrl({
    imageUrl,
    destinationUrl,
    description: (description + (hashtags ? '\n' + hashtags : '')).substring(0, 500),
  });

  // Mark opened first so it sticks even if the user closes the dashboard tab.
  await updateQueueItem(item.id, { status: 'opened' });

  // chrome.tabs.create works inside the queue page since it's an extension page.
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url, active: true });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  await render();
  if (copied) {
    showStatus('Pinterest opened. Full pin package copied to clipboard.', 'success');
  } else {
    showStatus('Pinterest opened. Copy the package manually if needed.', 'info');
  }
}

// ─── Header actions ────────────────────────────────────────────────────────

async function exportCsv() {
  const csv = await exportQueueToCsv();
  if (!csv || csv.trim() === buildCsv([]).trim()) {
    showStatus('Queue is empty — nothing to export.', 'warning');
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href        = url;
  a.download    = `affiliate-pin-queue-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
  showStatus('CSV exported.', 'success');
}

function clearPosted() {
  openConfirm({
    title:   'Clear posted pins?',
    message: 'Remove every pin marked Posted from your queue? This cannot be undone.',
    okLabel: 'Clear Posted',
    okClass: 'aps-q-btn-danger',
  }, async () => {
    const removed = await clearQueueByStatus('posted');
    closeConfirm();
    await render();
    showStatus(`${removed} posted pin${removed === 1 ? '' : 's'} cleared.`, 'success');
  });
}

function clearAll() {
  openConfirm({
    title:   'Clear ENTIRE queue?',
    message: 'This will permanently delete every pin in your queue, including drafts and opened items. This cannot be undone.',
    okLabel: 'Delete All',
    okClass: 'aps-q-btn-danger',
  }, async () => {
    await clearQueue();
    closeConfirm();
    await render();
    showStatus('Queue cleared.', 'success');
  });
}

// ─── Event bindings ────────────────────────────────────────────────────────

function bindEvents() {
  els.btnExportCsv  .addEventListener('click', exportCsv);
  els.btnClearPosted.addEventListener('click', clearPosted);
  els.btnClearAll   .addEventListener('click', clearAll);
  if (els.btnAutofixAll) els.btnAutofixAll.addEventListener('click', autoFixAllDrafts);

  els.filterSearch.addEventListener('input',  render);
  els.filterStatus.addEventListener('change', render);
  els.filterBoard .addEventListener('change', render);
  els.filterSort  .addEventListener('change', render);
  if (els.filterQuality) els.filterQuality.addEventListener('change', render);

  // Edit modal
  els.btnEditSave  .addEventListener('click', saveEdit);
  els.btnEditCancel.addEventListener('click', closeEditModal);
  document.querySelectorAll('#edit-modal [data-close-modal]').forEach(el => {
    el.addEventListener('click', closeEditModal);
  });

  // Confirm modal
  els.btnConfirmOk    .addEventListener('click', () => { if (confirmCb) confirmCb(); });
  els.btnConfirmCancel.addEventListener('click', closeConfirm);
  document.querySelectorAll('#confirm-modal [data-close-modal]').forEach(el => {
    el.addEventListener('click', closeConfirm);
  });

  // Re-render whenever the queue changes from elsewhere (e.g. popup saved
  // a new item in another tab).
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pinQueue) render();
    });
  }

  // Esc closes whichever modal is open.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!els.editModal.classList.contains('hidden'))    closeEditModal();
    if (!els.confirmModal.classList.contains('hidden')) closeConfirm();
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

bindEvents();
render().catch(e => {
  console.error('[AffiliatePinQueue] render error:', e);
  showStatus('Could not load queue: ' + e.message, 'error', 0);
});
