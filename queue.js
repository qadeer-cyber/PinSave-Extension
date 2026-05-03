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

  // Sidebar nav + view containers
  navQueue:         $('nav-queue'),
  navAnalytics:     $('nav-analytics'),
  navTemplates:     $('nav-templates'),
  navSettings:      $('nav-settings'),
  viewQueue:        $('view-queue'),
  viewAnalytics:    $('view-analytics'),
  viewTitle:        $('view-title'),
  viewSub:          $('view-sub'),
  toolbarActions:   $('toolbar-actions-queue'),

  // Summary (Queue)
  sumTotal:         $('sum-total'),
  sumDraft:         $('sum-draft'),
  sumOpened:        $('sum-opened'),
  sumPosted:        $('sum-posted'),
  sumSkipped:       $('sum-skipped'),
  sumToday:         $('sum-today'),
  sumReady:         $('sum-ready'),
  sumMissingAffil:  $('sum-missing-affiliate'),
  sumOldDrafts:     $('sum-old-drafts'),

  // Old-drafts banner
  bannerOldDrafts:        $('banner-old-drafts'),
  bannerOldDraftsText:    $('banner-old-drafts-text'),
  bannerOldDraftsFilter:  $('banner-old-drafts-filter'),

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

  // Analytics targets
  anTotal:          $('an-total'),
  anPosted:         $('an-posted'),
  anConversion:     $('an-conversion'),
  anAvgQuality:     $('an-avg-quality'),
  anWeek:           $('an-week'),
  chartDaily:       $('chart-daily'),
  chartStatus:      $('chart-status'),
  chartStatusValue: $('chart-status-value'),
  chartStatusLegend:$('chart-status-legend'),
  chartBoards:      $('chart-boards'),
  chartDeals:       $('chart-deals'),
  chartQuality:     $('chart-quality'),

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
  els.statusBar.className = `aps-status ${type}`;
  els.statusBar.classList.remove('hidden');
  if (timeoutMs > 0) {
    setTimeout(() => els.statusBar.classList.add('hidden'), timeoutMs);
  }
}

// ─── Phase 5 — analytics helpers ───────────────────────────────────────────

const OLD_DRAFT_AGE_DAYS = 7;

function isOldDraft(item) {
  if (!item || item.status !== 'draft') return false;
  const t = item.createdAt ? Date.parse(item.createdAt) : NaN;
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) > OLD_DRAFT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function isMissingAffiliate(item) {
  if (!item) return false;
  const url = item.affiliateUrl || '';
  if (!url) return true;
  return !/[?&]tag=[^&]+/i.test(url);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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

function openConfirm({ title, message, okLabel = 'Confirm', okClass = 'aps-btn-danger' }, onOk) {
  els.confirmTitle.textContent   = title;
  els.confirmMessage.textContent = message;
  els.btnConfirmOk.textContent   = okLabel;
  els.btnConfirmOk.className     = `aps-btn ${okClass}`;
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

  // Phase 5 — derived metrics.
  const ready          = items.filter(it => it.status !== 'skipped' && scorePinPackage(it) >= QUALITY_GOOD_THRESHOLD).length;
  const missingAffil   = items.filter(isMissingAffiliate).length;
  const oldDrafts      = items.filter(isOldDraft).length;

  if (els.sumReady)        els.sumReady.textContent        = ready;
  if (els.sumMissingAffil) els.sumMissingAffil.textContent = missingAffil;
  if (els.sumOldDrafts)    els.sumOldDrafts.textContent    = oldDrafts;

  // Old drafts banner.
  if (els.bannerOldDrafts) {
    if (oldDrafts > 0) {
      els.bannerOldDraftsText.textContent =
        `${oldDrafts} draft${oldDrafts === 1 ? '' : 's'} sitting for more than ${OLD_DRAFT_AGE_DAYS} days. Review or skip them to keep the queue tidy.`;
      els.bannerOldDrafts.classList.remove('hidden');
    } else {
      els.bannerOldDrafts.classList.add('hidden');
    }
  }
}

function renderBoardFilter(items) {
  const boards = Array.from(new Set(items.map(it => it.suggestedBoard).filter(Boolean))).sort();
  const current = els.filterBoard.value;
  els.filterBoard.innerHTML = '<option value="all">All</option>';
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
  card.className   = 'aps-item';
  card.dataset.id  = item.id;

  // ── thumbnail ──
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'aps-thumb';

  if (item.selectedImageUrl) {
    const img = document.createElement('img');
    img.alt       = item.pinterestTitle || 'Pin image';
    img.loading   = 'lazy';
    img.src       = item.selectedImageUrl;
    img.addEventListener('error', () => {
      img.remove();
      const ph = document.createElement('div');
      ph.className   = 'aps-thumb-empty';
      ph.textContent = 'Image failed to load';
      thumbWrap.appendChild(ph);
    });
    thumbWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className   = 'aps-thumb-empty';
    ph.textContent = 'No image';
    thumbWrap.appendChild(ph);
  }

  // Phase 5 — Floating badge layer (top-left status, top-right quality).
  const score    = scorePinPackage(item);
  const badges   = document.createElement('div');
  badges.className = 'aps-thumb-badges';

  const sBadge = document.createElement('span');
  sBadge.className   = `aps-status-badge ${item.status}`;
  sBadge.textContent = item.status;
  badges.appendChild(sBadge);

  const qBadge = document.createElement('span');
  qBadge.className   = 'aps-quality-chip ' + (
    score >= QUALITY_GOOD_THRESHOLD ? 'good' :
    score >= QUALITY_NEEDS_REVIEW_THRESHOLD ? 'warn' : 'bad'
  );
  qBadge.textContent = String(score);
  qBadge.title       = `Pin Quality Score: ${score}/100`;
  badges.appendChild(qBadge);

  thumbWrap.appendChild(badges);

  card.appendChild(thumbWrap);

  // ── body ──
  const body = document.createElement('div');
  body.className = 'aps-item-body';

  const title = document.createElement('div');
  title.className   = 'aps-item-title';
  title.textContent = item.pinterestTitle || item.productTitle || '(untitled)';
  body.appendChild(title);

  if (item.suggestedBoard) {
    const board = document.createElement('div');
    board.className   = 'aps-item-board';
    board.textContent = item.suggestedBoard;
    body.appendChild(board);
  }

  const meta = document.createElement('div');
  meta.className = 'aps-item-meta';
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
    ul.className = 'aps-item-warnings';
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
  actions.className = 'aps-item-actions';

  const btn = (label, cls, onClick, opts = {}) => {
    const b = document.createElement('button');
    b.className   = `aps-btn ${cls}` + (opts.wide ? ' aps-item-actions-wide' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  actions.appendChild(btn('Open Pinterest',    'aps-btn-primary',   () => openPinterestForItem(item),       { wide: true }));
  actions.appendChild(btn('Copy Full Package', 'aps-btn-secondary', () => copyToClipboard(buildFullPinPackageFromItem(item), 'Full Pin Package')));
  actions.appendChild(btn('Copy Affiliate',    'aps-btn-secondary', () => copyToClipboard(item.affiliateUrl || '', 'Affiliate link')));
  actions.appendChild(btn('Auto-Fix',          'aps-btn-secondary', () => autoFixItem(item.id)));
  actions.appendChild(btn('Edit',              'aps-btn-secondary', () => openEditModal(item)));
  actions.appendChild(btn('Mark Posted',       'aps-btn-secondary', () => markStatus(item.id, 'posted')));
  if (item.status !== 'skipped') {
    actions.appendChild(btn('Skip',            'aps-btn-secondary', () => markStatus(item.id, 'skipped')));
  } else {
    actions.appendChild(btn('Reopen',          'aps-btn-secondary', () => markStatus(item.id, 'draft')));
  }
  actions.appendChild(btn('Delete',            'aps-btn-danger',    () => confirmDelete(item), { wide: true }));

  card.appendChild(actions);
  return card;
}

async function render() {
  allItems = await getQueue();

  renderSummary(allItems);
  renderBoardFilter(allItems);
  renderAnalytics(allItems);

  const filtered = applyFiltersAndSort(allItems);

  els.grid.innerHTML = '';
  if (allItems.length === 0) {
    els.emptyMsg.classList.remove('hidden');
    return;
  }
  els.emptyMsg.classList.add('hidden');

  if (filtered.length === 0) {
    const note = document.createElement('p');
    note.className   = 'aps-empty';
    note.textContent = 'No items match your filters.';
    els.grid.appendChild(note);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of filtered) frag.appendChild(renderItem(item));
  els.grid.appendChild(frag);
}

// ─── Phase 5: Analytics ────────────────────────────────────────────────────

const ANALYTICS_DAYS = 14;

function renderAnalytics(items) {
  // Summary cards
  const total      = items.length;
  const posted     = items.filter(it => it.status === 'posted').length;
  const conversion = total ? Math.round((posted / total) * 100) : 0;

  const scores  = items.map(it => scorePinPackage(it));
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = items.filter(it => {
    const t = it.createdAt ? Date.parse(it.createdAt) : NaN;
    return !Number.isNaN(t) && t >= oneWeekAgo;
  }).length;

  if (els.anTotal)      els.anTotal.textContent      = String(total);
  if (els.anPosted)     els.anPosted.textContent     = String(posted);
  if (els.anConversion) els.anConversion.textContent = `${conversion}%`;
  if (els.anAvgQuality) els.anAvgQuality.textContent = String(avgScore);
  if (els.anWeek)       els.anWeek.textContent       = String(week);

  renderDailyBars(items);
  renderStatusDonut(items);
  renderBoardProgress(items);
  renderDealProgress(items);
  renderQualityProgress(items);
}

function renderDailyBars(items) {
  const host = els.chartDaily;
  if (!host) return;
  host.innerHTML = '';

  // Build a `Date -> count` map for the last ANALYTICS_DAYS days.
  const today = startOfDay(new Date());
  const days  = [];
  for (let i = ANALYTICS_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    days.push({ date: d, count: 0 });
  }

  for (const it of items) {
    if (!it.createdAt) continue;
    const t = Date.parse(it.createdAt);
    if (Number.isNaN(t)) continue;
    const ds = startOfDay(new Date(t)).getTime();
    const idx = days.findIndex(d => d.date.getTime() === ds);
    if (idx !== -1) days[idx].count += 1;
  }

  const max = Math.max(1, ...days.map(d => d.count));
  const dayLabel = d => d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);

  for (const d of days) {
    const col   = document.createElement('div');
    col.className = 'aps-bar' + (d.count === 0 ? ' zero' : '');
    col.title   = `${d.date.toLocaleDateString()} — ${d.count} pin${d.count === 1 ? '' : 's'}`;

    const value = document.createElement('div');
    value.className = 'aps-bar-value';
    value.textContent = String(d.count);
    col.appendChild(value);

    const fill  = document.createElement('div');
    fill.className = 'aps-bar-fill';
    const pct = Math.max(2, Math.round((d.count / max) * 100));
    fill.style.height = `${pct}%`;
    col.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'aps-bar-label';
    label.textContent = dayLabel(d.date);
    col.appendChild(label);

    host.appendChild(col);
  }
}

const STATUS_COLORS = {
  draft:   '#5e5ce6',
  opened:  '#0a84ff',
  posted:  '#30d158',
  skipped: '#8e8e93',
};

function renderStatusDonut(items) {
  const canvas = els.chartStatus;
  if (!canvas) return;

  const counts = { draft: 0, opened: 0, posted: 0, skipped: 0 };
  for (const it of items) {
    if (counts[it.status] !== undefined) counts[it.status] += 1;
  }
  const total = counts.draft + counts.opened + counts.posted + counts.skipped;

  if (els.chartStatusValue) els.chartStatusValue.textContent = String(total);

  // Render donut on canvas (HiDPI-aware).
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 140;
  const cssH = canvas.clientHeight || 140;
  if (canvas.width !== cssW * dpr) canvas.width = cssW * dpr;
  if (canvas.height !== cssH * dpr) canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cx = cssW / 2;
  const cy = cssH / 2;
  const radius = Math.min(cssW, cssH) / 2 - 4;
  const innerR = radius - 14;

  // Track ring (when no data).
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();

  if (total > 0) {
    let start = -Math.PI / 2;
    for (const key of ['draft', 'opened', 'posted', 'skipped']) {
      const v = counts[key];
      if (v === 0) continue;
      const sweep = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + sweep, false);
      ctx.arc(cx, cy, innerR, start + sweep, start, true);
      ctx.closePath();
      ctx.fillStyle = STATUS_COLORS[key];
      ctx.fill();
      start += sweep;
    }
  }

  // Legend
  const legend = els.chartStatusLegend;
  if (!legend) return;
  legend.innerHTML = '';
  const labelMap = { draft: 'Draft', opened: 'Opened', posted: 'Posted', skipped: 'Skipped' };
  for (const key of ['draft', 'opened', 'posted', 'skipped']) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'aps-legend-swatch';
    sw.style.background = STATUS_COLORS[key];
    const name = document.createElement('span');
    name.className = 'aps-legend-name';
    name.textContent = labelMap[key];
    const val = document.createElement('span');
    val.className = 'aps-legend-value';
    val.textContent = String(counts[key]);
    li.appendChild(sw);
    li.appendChild(name);
    li.appendChild(val);
    legend.appendChild(li);
  }
}

function renderProgressList(host, rows, options) {
  if (!host) return;
  const opts = options || {};
  host.innerHTML = '';
  if (!rows.length) return; // CSS :empty rule shows "No data yet."

  const max = Math.max(1, ...rows.map(r => r.value));

  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'aps-progress-row';

    const meta = document.createElement('div');
    meta.className = 'aps-progress-meta';

    const label = document.createElement('div');
    label.className = 'aps-progress-label';

    const labelName = document.createElement('span');
    labelName.className = 'aps-progress-label-name';
    labelName.textContent = row.label;

    const labelSub = document.createElement('span');
    labelSub.className = 'aps-progress-label-sub';
    labelSub.textContent = row.sub || '';

    label.appendChild(labelName);
    if (row.sub) label.appendChild(labelSub);
    meta.appendChild(label);

    const track = document.createElement('div');
    track.className = 'aps-progress-track';
    const bar = document.createElement('div');
    bar.className = 'aps-progress-bar' + (row.tone ? ' ' + row.tone : '');
    const pct = Math.max(2, Math.round((row.value / max) * 100));
    bar.style.width = `${pct}%`;
    track.appendChild(bar);
    meta.appendChild(track);

    const value = document.createElement('div');
    value.className = 'aps-progress-value';
    value.textContent = opts.formatValue ? opts.formatValue(row.value) : String(row.value);

    li.appendChild(meta);
    li.appendChild(value);
    host.appendChild(li);
  }
}

function renderBoardProgress(items) {
  const buckets = new Map();
  for (const it of items) {
    const key = (it.suggestedBoard || '').trim() || '— No board —';
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const rows = Array.from(buckets.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  renderProgressList(els.chartBoards, rows);
}

const DEAL_LABELS = {
  coupon:     'Coupon code',
  percent:    'Percent off',
  lightning:  'Lightning deal',
  prime:      'Prime exclusive',
  discount:   'Discount / sale',
  none:       'No deal signal',
};

function classifyDeal(item) {
  // An explicit coupon code on the item beats any text-pattern guess.
  if (item.couponCode && String(item.couponCode).trim()) return 'coupon';

  const hay = [
    item.facebookCaption, item.pinterestDescription, item.dealType,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return 'none';

  if (/\bcoupon\b|\bpromo\b|use code|code[: ]+\S{3,}/i.test(hay)) return 'coupon';
  if (/\b\d{1,3}\s?%\s?off\b|\bpercent off\b/i.test(hay))         return 'percent';
  if (/lightning|flash sale/i.test(hay))                          return 'lightning';
  if (/prime\s+(deal|exclusive|early)/i.test(hay))                return 'prime';
  if (/\bdeal\b|\bsale\b|\bdiscount\b|price drop/i.test(hay))     return 'discount';
  return 'none';
}

function renderDealProgress(items) {
  const buckets = new Map();
  for (const it of items) {
    const key = classifyDeal(it);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const order = ['coupon', 'percent', 'lightning', 'prime', 'discount', 'none'];
  const rows = order
    .filter(k => buckets.has(k))
    .map(k => ({ label: DEAL_LABELS[k], value: buckets.get(k), tone: k === 'none' ? 'info' : 'success' }));
  renderProgressList(els.chartDeals, rows);
}

function renderQualityProgress(items) {
  const buckets = [
    { label: 'Excellent (80–100)', min: 80, max: 100, tone: 'success' },
    { label: 'Good (70–79)',       min: 70, max: 79,  tone: 'info'    },
    { label: 'Needs review (50–69)', min: 50, max: 69, tone: 'warning' },
    { label: 'Weak (0–49)',        min: 0,  max: 49,  tone: 'danger'  },
  ];
  const counts = buckets.map(b => 0);
  for (const it of items) {
    const s = scorePinPackage(it);
    const idx = buckets.findIndex(b => s >= b.min && s <= b.max);
    if (idx !== -1) counts[idx] += 1;
  }
  const rows = buckets.map((b, i) => ({
    label: b.label,
    value: counts[i],
    tone:  b.tone,
  }));
  renderProgressList(els.chartQuality, rows);
}

// ─── Phase 5: View switching ───────────────────────────────────────────────

function setView(view) {
  const isQueue = view !== 'analytics';
  els.viewQueue.classList.toggle('hidden', !isQueue);
  els.viewAnalytics.classList.toggle('hidden', isQueue);

  for (const btn of [els.navQueue, els.navAnalytics]) {
    if (!btn) continue;
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else        btn.removeAttribute('aria-current');
  }

  // Toolbar context.
  if (els.viewTitle) els.viewTitle.textContent = isQueue ? 'Queue' : 'Analytics';
  if (els.viewSub)   els.viewSub.textContent   = isQueue
    ? 'All affiliate pins captured for review.'
    : 'On-device analytics for your captured pins.';
  if (els.toolbarActions) els.toolbarActions.classList.toggle('hidden', !isQueue);
}

function openOptionsAnchor(anchor) {
  // Best-effort: open options.html and append a hash for the requested anchor.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL && chrome.tabs && chrome.tabs.create) {
    const url = chrome.runtime.getURL('options.html') + (anchor ? `#${anchor}` : '');
    chrome.tabs.create({ url });
    return;
  }
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
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
    okClass: 'aps-btn-primary',
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
    okClass:  'aps-btn-danger',
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
    okClass: 'aps-btn-danger',
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
    okClass: 'aps-btn-danger',
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

  // ── Phase 5: Sidebar nav ──
  if (els.navQueue)     els.navQueue    .addEventListener('click', () => setView('queue'));
  if (els.navAnalytics) els.navAnalytics.addEventListener('click', () => setView('analytics'));
  if (els.navTemplates) els.navTemplates.addEventListener('click', () => openOptionsAnchor('templates'));
  if (els.navSettings)  els.navSettings .addEventListener('click', () => openOptionsAnchor(''));

  // Old-drafts banner: jump to drafts via the status filter.
  if (els.bannerOldDraftsFilter) {
    els.bannerOldDraftsFilter.addEventListener('click', () => {
      els.filterStatus.value  = 'draft';
      els.filterSort.value    = 'oldest';
      els.filterQuality.value = 'all';
      els.filterSearch.value  = '';
      setView('queue');
      render();
    });
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

bindEvents();
render().catch(e => {
  console.error('[AffiliatePinQueue] render error:', e);
  showStatus('Could not load queue: ' + e.message, 'error', 0);
});
