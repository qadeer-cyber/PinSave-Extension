/*
 * manualBoardPatch.js
 *
 * Adds a "Board" picker to the popup's manual-link banner. Boards are
 * cached in chrome.storage.local.user_boards (refreshed in the dashboard);
 * a datalist autocomplete renders them. When the user picks a board by
 * name, this module exposes both the board name and (when known) the
 * corresponding board id for manualApiSavePatch.js to call createPin().
 *
 * If the popup can't reach Pinterest at all (offline / cookies missing),
 * the field still works as a free-text label that gets stored in
 * pin_history for the dashboard.
 */
(function () {
  'use strict';

  const HOST_WRAP_ID = 'pbe-destination-link-wrap';
  const LINK_INPUT_ID = 'pbe-destination-link';
  const FIELD_ROW_ID = 'pbe-board-row';
  const INPUT_ID = 'pbe-destination-board';
  const DATALIST_ID = 'pbe-board-options';
  const STATUS_ID = 'pbe-board-status';
  const STORAGE_KEY = 'user_boards';
  const STORAGE_PENDING = 'pbe_pending_board';

  let cachedBoards = [];

  function getInput() {
    return document.getElementById(INPUT_ID);
  }

  function getBoardSelection() {
    const input = getInput();
    const name = input ? input.value.trim() : '';
    if (!name) return null;
    const match = cachedBoards.find(function (b) {
      return b.name && b.name.toLowerCase() === name.toLowerCase();
    });
    return {
      name: name,
      id: match ? match.id : null
    };
  }

  function consumeBoardSelection() {
    const sel = getBoardSelection();
    const input = getInput();
    if (input) input.value = '';
    return sel;
  }

  window.__pbe_getManualBoard = getBoardSelection;
  window.__pbe_consumeManualBoard = consumeBoardSelection;

  function setStatus(text, isError) {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = text || '';
    status.style.color = isError ? '#e60023' : '#6b7280';
  }

  function rebuildDatalist() {
    const list = document.getElementById(DATALIST_ID);
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    cachedBoards.forEach(function (b) {
      const opt = document.createElement('option');
      opt.value = b.name;
      if (b.privacy && b.privacy !== 'public') opt.label = b.name + ' (' + b.privacy + ')';
      list.appendChild(opt);
    });
  }

  function loadCachedBoards() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([STORAGE_KEY], function (items) {
      const list = items[STORAGE_KEY];
      if (Array.isArray(list)) {
        cachedBoards = list.filter(function (b) { return b && b.name; });
        rebuildDatalist();
      }
    });
  }

  function refreshBoardsFromPinterest() {
    if (!window.__pbe_PinterestApi || !window.__pbe_PinterestApi.getBoards) {
      setStatus('Pinterest API helper not loaded.', true);
      return;
    }
    setStatus('Loading boards...', false);
    window.__pbe_PinterestApi.getBoards().then(function (boards) {
      cachedBoards = boards || [];
      rebuildDatalist();
      if (chrome && chrome.storage && chrome.storage.local) {
        const u = {}; u[STORAGE_KEY] = cachedBoards;
        chrome.storage.local.set(u);
      }
      setStatus('Loaded ' + cachedBoards.length + ' board' + (cachedBoards.length === 1 ? '' : 's') + '.', false);
    }).catch(function (err) {
      setStatus('Sign in to pinterest.com to load boards.', true);
      // Surface error to console for debugging without spamming the user.
      console.warn('[pbe] getBoards failed:', err && err.message);
    });
  }

  function injectField() {
    if (!document.body) return;
    if (document.getElementById(FIELD_ROW_ID)) return;
    const host = document.getElementById(HOST_WRAP_ID);
    if (!host) return;

    const row = document.createElement('div');
    row.id = FIELD_ROW_ID;
    row.style.cssText = 'margin-top:8px;';

    const label = document.createElement('label');
    label.htmlFor = INPUT_ID;
    label.textContent = 'Board';
    label.style.cssText = 'display:block;font-size:12px;font-weight:700;color:#111;margin-bottom:6px;';

    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'text';
    input.autocomplete = 'off';
    input.setAttribute('list', DATALIST_ID);
    input.placeholder = 'Pick a board';
    input.style.cssText = [
      'flex:1 1 auto',
      'height:34px',
      'border:1px solid #ddd',
      'border-radius:8px',
      'padding:0 10px',
      'font-size:12px',
      'box-sizing:border-box',
      'outline:none',
      'font-family:inherit'
    ].join(';');

    const datalist = document.createElement('datalist');
    datalist.id = DATALIST_ID;

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.title = 'Reload boards from your Pinterest account';
    refreshBtn.style.cssText = [
      'flex:0 0 auto',
      'height:34px',
      'padding:0 12px',
      'border:1px solid #ddd',
      'border-radius:8px',
      'background:#fafafa',
      'font-size:11px',
      'font-weight:700',
      'cursor:pointer',
      'font-family:inherit',
      'color:#111'
    ].join(';');
    refreshBtn.addEventListener('click', refreshBoardsFromPinterest);

    inputWrap.appendChild(input);
    inputWrap.appendChild(refreshBtn);

    const status = document.createElement('div');
    status.id = STATUS_ID;
    status.style.cssText = 'margin-top:4px;font-size:10px;color:#6b7280;text-align:right;font-weight:600;min-height:12px;';

    row.appendChild(label);
    row.appendChild(inputWrap);
    row.appendChild(datalist);
    row.appendChild(status);
    host.appendChild(row);

    document.documentElement.style.setProperty('--pbe-manual-link-offset', '300px');
  }

  function destinationFieldHasValue() {
    const di = document.getElementById(LINK_INPUT_ID);
    return !!(di && di.value.trim());
  }

  /*
   * As a safety net, also stash the selected board into chrome.storage so
   * dashboardLogger.js can pre-pick it on the Pinterest pin builder when
   * the API call fails and we fall back to the tab flow.
   */
  const previousOpen = window.open;
  window.open = function (url, name, features) {
    if (typeof url === 'string' && url.indexOf('pinterest.com/pin/create/extension/') !== -1) {
      if (destinationFieldHasValue()) {
        const sel = getBoardSelection();
        if (sel && sel.name) {
          try {
            if (chrome && chrome.storage && chrome.storage.local) {
              const u = {}; u[STORAGE_PENDING] = { name: sel.name, id: sel.id || null, timestamp: Date.now() };
              chrome.storage.local.set(u);
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    return previousOpen.call(window, url, name, features);
  };

  injectField();
  new MutationObserver(injectField).observe(document.documentElement, { childList: true, subtree: true });
  loadCachedBoards();
  // Best-effort: refresh boards when the popup opens so the autocomplete is
  // never stale on a fresh login. Silent failure if not signed in.
  if (window.__pbe_PinterestApi) {
    window.__pbe_PinterestApi.isLoggedIn().then(function (ok) {
      if (ok) refreshBoardsFromPinterest();
    }).catch(function () { /* ignore */ });
  }
})();
