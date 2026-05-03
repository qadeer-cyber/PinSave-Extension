/**
 * utils/queue.js
 * Local queue storage for the Phase 3 Batch Queue + Posting Workflow.
 *
 * Persists every captured pin package as an item in chrome.storage.local
 * under the key `pinQueue`. Items are plain objects (no Maps/Dates/etc) so
 * they round-trip cleanly through chrome.storage.
 *
 * Status lifecycle:
 *   draft → opened (after Open Pinterest) → posted (after Mark Posted)
 *                                          ↘ skipped (user opt-out)
 *
 * No external network calls. No analytics. All data stays on-device.
 */

const QUEUE_STORAGE_KEY = 'pinQueue';

const QUEUE_STATUSES = ['draft', 'opened', 'posted', 'skipped'];

/**
 * CSV header order for exportQueueToCsv. Kept in one place so the export
 * format is documented and stable.
 */
const CSV_COLUMNS = [
  'createdAt',
  'status',
  'productTitle',
  'pinterestTitle',
  'suggestedBoard',
  'affiliateUrl',
  'amazonUrl',
  'asin',
  'couponCode',
  'dealType',
  'sourceFacebookUrl',
];

// ─── ASIN extraction ────────────────────────────────────────────────────────

/**
 * Pull an Amazon ASIN out of a full Amazon URL. Returns '' if not found.
 * Short links (amzn.to / a.co) don't contain the ASIN until resolved, so
 * we only attempt the match on full amazon.* URLs.
 *
 * Patterns covered:
 *   /dp/B0XXXXXXXX
 *   /gp/product/B0XXXXXXXX
 *   /product/B0XXXXXXXX
 *   /ASIN/B0XXXXXXXX
 *   query string ?asin=B0XXXXXXXX
 */
function extractAsinFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const m = url.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i)
         || url.match(/[?&]asin=([A-Z0-9]{10})\b/i);
  return m ? m[1].toUpperCase() : '';
}

// ─── ID + utility helpers ──────────────────────────────────────────────────

function makeQueueId() {
  // Not cryptographic — just unique enough for local storage.
  const rnd = Math.random().toString(36).slice(2, 10);
  return `q_${Date.now().toString(36)}_${rnd}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(v) {
  return v == null ? '' : String(v);
}

// ─── Storage primitives ─────────────────────────────────────────────────────

/**
 * Read the current queue (newest first). Always returns an array, even
 * when nothing is stored yet.
 */
async function getQueue() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return [];
  }
  const raw = await chrome.storage.local.get([QUEUE_STORAGE_KEY]);
  const arr = raw[QUEUE_STORAGE_KEY];
  return Array.isArray(arr) ? arr : [];
}

async function _writeQueue(items) {
  await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: items });
}

// ─── Normalisation ──────────────────────────────────────────────────────────

/**
 * Normalise an inbound item (from the popup) into the canonical queue
 * record shape. Fills derived fields (asin) and stamps timestamps + status.
 *
 * The caller passes the user-facing data; we add the bookkeeping fields.
 */
function buildQueueItem(input) {
  const amazonUrl    = safeString(input.amazonUrl);
  const affiliateUrl = safeString(input.affiliateUrl);
  const asin = safeString(input.asin)
            || extractAsinFromUrl(amazonUrl)
            || extractAsinFromUrl(affiliateUrl);

  return {
    id:                  input.id || makeQueueId(),
    createdAt:           input.createdAt || nowIso(),
    updatedAt:           nowIso(),
    status:              QUEUE_STATUSES.includes(input.status) ? input.status : 'draft',

    productTitle:        safeString(input.productTitle),
    pinterestTitle:      safeString(input.pinterestTitle),
    pinterestDescription: safeString(input.pinterestDescription),
    hashtags:            safeString(input.hashtags),
    suggestedBoard:      safeString(input.suggestedBoard),
    taggedTopics:        safeString(input.taggedTopics),
    altText:             safeString(input.altText),
    facebookCaption:     safeString(input.facebookCaption),

    sourceFacebookUrl:   safeString(input.sourceFacebookUrl),
    selectedImageUrl:    safeString(input.selectedImageUrl),
    amazonUrl,
    affiliateUrl,
    asin,

    couponCode:          safeString(input.couponCode),
    dealType:            safeString(input.dealType),
  };
}

// ─── Duplicate detection ────────────────────────────────────────────────────

/**
 * Find an existing queue item that looks like a duplicate of `candidate`.
 * Match priority (first hit wins):
 *   1. same ASIN (when both have one)
 *   2. same affiliateUrl
 *   3. same amazonUrl
 *   4. same productTitle + same selectedImageUrl
 *
 * Returns the matching item, or null.
 */
function findDuplicateInList(candidate, list) {
  if (!candidate || !Array.isArray(list)) return null;
  const c = buildQueueItem(candidate);

  // 1. ASIN
  if (c.asin) {
    const hit = list.find(it => it.asin && it.asin === c.asin);
    if (hit) return hit;
  }

  // 2. affiliateUrl
  if (c.affiliateUrl) {
    const hit = list.find(it => it.affiliateUrl && it.affiliateUrl === c.affiliateUrl);
    if (hit) return hit;
  }

  // 3. amazonUrl
  if (c.amazonUrl) {
    const hit = list.find(it => it.amazonUrl && it.amazonUrl === c.amazonUrl);
    if (hit) return hit;
  }

  // 4. title + image fallback
  if (c.productTitle && c.selectedImageUrl) {
    const hit = list.find(it =>
      it.productTitle && it.productTitle === c.productTitle &&
      it.selectedImageUrl === c.selectedImageUrl
    );
    if (hit) return hit;
  }

  return null;
}

async function findDuplicateQueueItem(candidate) {
  const list = await getQueue();
  return findDuplicateInList(candidate, list);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Save a new item to the queue (newest first).
 *
 * `opts.allowDuplicate` (default false): when false, returns
 * `{ saved: false, duplicate }` instead of inserting if a duplicate is
 * detected. The popup can prompt the user and retry with allowDuplicate=true.
 */
async function saveQueueItem(item, opts = {}) {
  const allowDuplicate = !!opts.allowDuplicate;
  const list = await getQueue();

  const duplicate = findDuplicateInList(item, list);
  if (duplicate && !allowDuplicate) {
    return { saved: false, duplicate };
  }

  const record = buildQueueItem(item);
  list.unshift(record);
  await _writeQueue(list);
  return { saved: true, item: record };
}

async function updateQueueItem(id, updates) {
  if (!id) return null;
  const list = await getQueue();
  const idx  = list.findIndex(it => it.id === id);
  if (idx === -1) return null;

  const merged = { ...list[idx], ...updates, id, updatedAt: nowIso() };
  if (updates.status && !QUEUE_STATUSES.includes(updates.status)) {
    merged.status = list[idx].status;
  }
  // Re-derive ASIN if the URLs changed and no explicit ASIN was passed.
  if ((updates.amazonUrl || updates.affiliateUrl) && updates.asin === undefined) {
    merged.asin = extractAsinFromUrl(merged.amazonUrl)
               || extractAsinFromUrl(merged.affiliateUrl)
               || merged.asin
               || '';
  }

  list[idx] = merged;
  await _writeQueue(list);
  return merged;
}

async function deleteQueueItem(id) {
  if (!id) return false;
  const list = await getQueue();
  const next = list.filter(it => it.id !== id);
  if (next.length === list.length) return false;
  await _writeQueue(next);
  return true;
}

async function clearQueue() {
  await _writeQueue([]);
}

async function clearQueueByStatus(status) {
  const list = await getQueue();
  const next = list.filter(it => it.status !== status);
  await _writeQueue(next);
  return list.length - next.length;
}

// ─── CSV export ─────────────────────────────────────────────────────────────

function csvEscape(value) {
  const s = safeString(value);
  if (s === '') return '';
  // Strip newlines so columns stay one-per-row.
  const flat = s.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[",]/.test(flat)) {
    return '"' + flat.replace(/"/g, '""') + '"';
  }
  return flat;
}

function buildCsv(items) {
  const lines = [];
  lines.push(CSV_COLUMNS.join(','));
  for (const it of items) {
    lines.push(CSV_COLUMNS.map(col => csvEscape(it[col])).join(','));
  }
  // CRLF for spreadsheet apps.
  return lines.join('\r\n') + '\r\n';
}

/**
 * Build a CSV string for the current queue. Returns the raw CSV text — the
 * caller is responsible for triggering the download (queue.js does this).
 */
async function exportQueueToCsv() {
  const list = await getQueue();
  return buildCsv(list);
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
      && d.getMonth()    === now.getMonth()
      && d.getDate()     === now.getDate();
}

function summarizeQueue(list) {
  const summary = {
    total:    list.length,
    draft:    0,
    opened:   0,
    posted:   0,
    skipped:  0,
    capturedToday: 0,
    openedToday:   0,
    postedToday:   0,
  };

  for (const it of list) {
    if (QUEUE_STATUSES.includes(it.status)) summary[it.status]++;
    if (isToday(it.createdAt)) summary.capturedToday++;
    if (it.status === 'opened' && isToday(it.updatedAt)) summary.openedToday++;
    if (it.status === 'posted' && isToday(it.updatedAt)) summary.postedToday++;
  }

  return summary;
}

// ─── Exports (Node + browser globals) ───────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    QUEUE_STORAGE_KEY,
    QUEUE_STATUSES,
    CSV_COLUMNS,

    extractAsinFromUrl,
    buildQueueItem,
    buildCsv,
    summarizeQueue,
    findDuplicateInList,

    getQueue,
    saveQueueItem,
    updateQueueItem,
    deleteQueueItem,
    clearQueue,
    clearQueueByStatus,
    findDuplicateQueueItem,
    exportQueueToCsv,
  };
}
