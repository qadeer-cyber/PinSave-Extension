/*
 * dashboard.js - reads pin_history from chrome.storage.local and renders
 * headline stats, a 30-day bar chart, top-N breakdowns, and a recent pins
 * table. Plain DOM, no framework.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'pin_history';
  const DAY_MS = 24 * 60 * 60 * 1000;

  /* ---------- storage shim (works inside extension and as fallback) ---------- */

  function loadHistory() {
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORAGE_KEY], function (items) {
          resolve(Array.isArray(items[STORAGE_KEY]) ? items[STORAGE_KEY] : []);
        });
      } else {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          resolve(raw ? JSON.parse(raw) : []);
        } catch (e) {
          resolve([]);
        }
      }
    });
  }

  function clearHistory() {
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(STORAGE_KEY, resolve);
      } else {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        resolve();
      }
    });
  }

  /* ---------- aggregation ---------- */

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function aggregate(history) {
    const now = Date.now();
    const todayStart = startOfDay(now);
    const yesterdayStart = todayStart - DAY_MS;
    const weekStart = todayStart - 6 * DAY_MS;
    const monthStart = todayStart - 29 * DAY_MS;

    const byDay = {};
    const byTag = {};
    const byMarket = {};
    const byDomain = {};
    const byAsin = {};
    const asinMeta = {};
    let today = 0, yesterday = 0, week = 0, month = 0;

    const tagSet = new Set();
    const asinSet = new Set();

    for (let i = 0; i < history.length; i++) {
      const r = history[i];
      const t = typeof r.timestamp === 'number' ? r.timestamp : Date.parse(r.timestamp || '');
      if (!isFinite(t)) continue;

      const dayKey = startOfDay(t);
      byDay[dayKey] = (byDay[dayKey] || 0) + 1;

      if (dayKey === todayStart) today += 1;
      if (dayKey === yesterdayStart) yesterday += 1;
      if (t >= weekStart) week += 1;
      if (t >= monthStart) month += 1;

      if (r.affiliateTag) {
        byTag[r.affiliateTag] = (byTag[r.affiliateTag] || 0) + 1;
        tagSet.add(r.affiliateTag);
      }
      if (r.marketplace) {
        byMarket[r.marketplace] = (byMarket[r.marketplace] || 0) + 1;
      }
      if (r.domain) {
        byDomain[r.domain] = (byDomain[r.domain] || 0) + 1;
      }
      if (r.asin) {
        byAsin[r.asin] = (byAsin[r.asin] || 0) + 1;
        asinSet.add(r.asin);
        if (!asinMeta[r.asin]) {
          asinMeta[r.asin] = { destinationUrl: r.destinationUrl, imageUrl: r.imageUrl };
        }
      }
    }

    return {
      total: history.length,
      today, yesterday, week, month,
      uniqueTags: tagSet.size,
      uniqueAsins: asinSet.size,
      byDay, byTag, byMarket, byDomain, byAsin, asinMeta
    };
  }

  function topN(map, n) {
    const arr = Object.keys(map).map(function (k) { return { key: k, count: map[k] }; });
    arr.sort(function (a, b) { return b.count - a.count; });
    return arr.slice(0, n);
  }

  /* ---------- rendering ---------- */

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderStats(agg) {
    setText('statAll', agg.total.toLocaleString());
    setText('statToday', agg.today.toLocaleString());
    setText('statWeek', agg.week.toLocaleString());
    setText('statMonth', agg.month.toLocaleString());
    setText('statTags', agg.uniqueTags.toLocaleString());
    setText('statAsins', agg.uniqueAsins.toLocaleString());

    const diff = agg.today - agg.yesterday;
    const sign = diff > 0 ? '+' : '';
    setText('statTodayFoot', 'vs. yesterday: ' + sign + diff);
  }

  function renderChart(agg) {
    const chart = document.getElementById('chart');
    if (!chart) return;
    chart.innerHTML = '';

    const todayStart = startOfDay(Date.now());
    let max = 1;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const dayKey = todayStart - i * DAY_MS;
      const count = agg.byDay[dayKey] || 0;
      if (count > max) max = count;
      days.push({ dayKey, count });
    }

    let total = 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      total += d.count;
      const bar = document.createElement('div');
      bar.className = 'bar' + (d.count === 0 ? ' zero' : '');
      const heightPct = Math.max(2, Math.round((d.count / max) * 100));
      bar.style.height = heightPct + '%';
      const label = new Date(d.dayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      bar.setAttribute('data-tooltip', label + ' \u2014 ' + d.count + ' pin' + (d.count === 1 ? '' : 's'));
      chart.appendChild(bar);
    }

    setText('chartTotal', total.toLocaleString() + ' total');
  }

  function renderBarList(containerId, items, opts) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = (opts && opts.emptyText) || 'No data yet';
      container.appendChild(empty);
      return;
    }

    const max = items[0].count;
    items.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'bar-row';

      const label = document.createElement('div');
      label.className = 'label';
      label.title = item.key;
      label.textContent = item.key;

      const count = document.createElement('div');
      count.className = 'count';
      count.textContent = item.count.toLocaleString();

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = Math.max(4, Math.round((item.count / max) * 100)) + '%';
      track.appendChild(fill);

      row.appendChild(label);
      row.appendChild(count);
      row.appendChild(track);
      container.appendChild(row);
    });
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.round(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.round(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.round(hr / 24);
    if (day < 30) return day + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function renderRecent(history) {
    const body = document.getElementById('recentBody');
    if (!body) return;
    body.innerHTML = '';

    const recent = history.slice().sort(function (a, b) { return b.timestamp - a.timestamp; }).slice(0, 50);
    setText('recentCount', recent.length + ' shown');

    recent.forEach(function (r) {
      const tr = document.createElement('tr');

      const tdThumb = document.createElement('td');
      tdThumb.className = 'col-thumb';
      if (r.imageUrl) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.src = r.imageUrl;
        img.onerror = function () {
          const fb = document.createElement('div');
          fb.className = 'thumb-fallback';
          fb.textContent = 'IMG';
          tdThumb.replaceChildren(fb);
        };
        tdThumb.appendChild(img);
      } else {
        const fb = document.createElement('div');
        fb.className = 'thumb-fallback';
        fb.textContent = '\u2014';
        tdThumb.appendChild(fb);
      }

      const tdWhen = document.createElement('td');
      tdWhen.title = new Date(r.timestamp).toLocaleString();
      tdWhen.textContent = timeAgo(r.timestamp);

      const tdMarket = document.createElement('td');
      tdMarket.textContent = r.marketplace || '\u2014';

      const tdAsin = document.createElement('td');
      tdAsin.textContent = r.asin || '\u2014';

      const tdTag = document.createElement('td');
      tdTag.textContent = r.affiliateTag || '\u2014';

      const tdDest = document.createElement('td');
      if (r.destinationUrl) {
        const a = document.createElement('a');
        a.href = r.destinationUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'truncate';
        a.title = r.destinationUrl;
        a.textContent = r.destinationUrl;
        tdDest.appendChild(a);
      } else {
        tdDest.textContent = '\u2014';
      }

      const tdSource = document.createElement('td');
      if (r.sourceUrl) {
        const a = document.createElement('a');
        a.href = r.sourceUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'truncate';
        a.title = r.sourceUrl;
        try {
          a.textContent = new URL(r.sourceUrl).hostname.replace(/^www\./, '');
        } catch (e) {
          a.textContent = r.sourceUrl;
        }
        tdSource.appendChild(a);
      } else {
        tdSource.textContent = '\u2014';
      }

      tr.appendChild(tdThumb);
      tr.appendChild(tdWhen);
      tr.appendChild(tdMarket);
      tr.appendChild(tdAsin);
      tr.appendChild(tdTag);
      tr.appendChild(tdDest);
      tr.appendChild(tdSource);
      body.appendChild(tr);
    });
  }

  function renderEmpty(history) {
    const empty = document.getElementById('emptyState');
    if (empty) empty.hidden = history.length > 0;
  }

  function render(history) {
    const agg = aggregate(history);
    renderStats(agg);
    renderChart(agg);
    renderBarList('topTags', topN(agg.byTag, 10), { emptyText: 'No affiliate tags detected yet' });
    renderBarList('topMarkets', topN(agg.byMarket, 10), { emptyText: 'No marketplaces detected yet' });
    renderBarList('topDomains', topN(agg.byDomain, 10), { emptyText: 'No destination domains yet' });
    renderBarList('topAsins', topN(agg.byAsin, 10), { emptyText: 'No Amazon ASINs detected yet' });
    renderRecent(history);
    renderEmpty(history);
  }

  /* ---------- CSV export ---------- */

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv(history) {
    const headers = ['timestamp_iso', 'marketplace', 'domain', 'asin', 'affiliate_tag', 'destination_url', 'image_url', 'source_url', 'description'];
    const rows = [headers.join(',')];
    history.slice().sort(function (a, b) { return b.timestamp - a.timestamp; }).forEach(function (r) {
      rows.push([
        new Date(r.timestamp).toISOString(),
        r.marketplace || '',
        r.domain || '',
        r.asin || '',
        r.affiliateTag || '',
        r.destinationUrl || '',
        r.imageUrl || '',
        r.sourceUrl || '',
        r.description || ''
      ].map(csvEscape).join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'affiliate-pins-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- bootstrap ---------- */

  function refresh() {
    loadHistory().then(render);
  }

  document.addEventListener('DOMContentLoaded', function () {
    refresh();

    document.getElementById('refreshBtn').addEventListener('click', refresh);

    document.getElementById('exportBtn').addEventListener('click', function () {
      loadHistory().then(exportCsv);
    });

    document.getElementById('clearBtn').addEventListener('click', function () {
      const ok = window.confirm('Clear all locally recorded pins? This cannot be undone.');
      if (!ok) return;
      clearHistory().then(refresh);
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[STORAGE_KEY]) refresh();
      });
    }
  });
})();
