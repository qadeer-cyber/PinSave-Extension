/*
 * manualApiSavePatch.js
 *
 * Outermost window.open wrapper for the popup's Save flow.
 *
 * When the popup's bundle.js calls window.open(...) to launch Pinterest's
 * pin builder, this wrapper intercepts. It reads the manual fields
 * (destination link, image, title, description, board) and tries to create
 * the pin directly via Pinterest's internal /resource/PinResource/create/
 * endpoint, using the user's logged-in pinterest.com session cookies (no
 * OAuth, no developer app).
 *
 * Success  -> show a green toast in the banner, return null (no tab opens).
 * Failure  -> show a red toast and call the previous window.open chain so
 *              Pinterest's pin builder still opens as a fallback (existing
 *              behavior is preserved end-to-end if anything goes wrong).
 *
 * Loaded AFTER manualBoardPatch.js, manualTitlePatch.js, manualDescriptionPatch.js,
 * and manualLinkPatch.js, so its window.open wrap is the outermost.
 */
(function () {
  'use strict';

  const HOST_WRAP_ID = 'pbe-destination-link-wrap';
  const TOAST_ID = 'pbe-api-save-toast';

  function getBannerHost() {
    return document.getElementById(HOST_WRAP_ID) || document.body;
  }

  function ensureToast() {
    let toast = document.getElementById(TOAST_ID);
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.style.cssText = [
      'margin-top:8px',
      'padding:8px 10px',
      'border-radius:8px',
      'font-size:11px',
      'font-weight:700',
      'line-height:1.35',
      'display:none',
      'word-break:break-word'
    ].join(';');
    const host = getBannerHost();
    host.appendChild(toast);
    return toast;
  }

  function showToast(message, kind) {
    const toast = ensureToast();
    toast.textContent = message;
    if (kind === 'success') {
      toast.style.background = '#e9f8ef';
      toast.style.color = '#0a6e35';
      toast.style.border = '1px solid #b8e6c7';
    } else if (kind === 'error') {
      toast.style.background = '#fff0f1';
      toast.style.color = '#a40b22';
      toast.style.border = '1px solid #f7c3ca';
    } else {
      toast.style.background = '#f4f4f4';
      toast.style.color = '#333';
      toast.style.border = '1px solid #e0e0e0';
    }
    toast.style.display = 'block';
  }

  function clearToast() {
    const toast = document.getElementById(TOAST_ID);
    if (toast) toast.style.display = 'none';
  }

  /*
   * Read fields straight from the popup's inputs, NOT from the URL search
   * params. The other patches (link/description) also rewrite those params
   * inside the chain, but we run as the outermost wrapper -- so by the
   * time we see rawUrl, none of the inner rewrites have applied yet.
   * The only thing we still take from rawUrl is `media` (image URL),
   * because no patch rewrites it and there is no manual override input.
   */
  function readManualParams(rawUrl) {
    let media = '';
    let urlFromBuilder = '';
    let descFromBuilder = '';
    try {
      const u = new URL(rawUrl);
      media = u.searchParams.get('media') || u.searchParams.get('image') || '';
      urlFromBuilder = u.searchParams.get('url') || '';
      descFromBuilder = u.searchParams.get('description') || '';
    } catch (e) { /* keep defaults */ }

    const linkInput = document.getElementById('pbe-destination-link');
    const link = linkInput ? linkInput.value.trim() : '';
    const descInput = document.getElementById('pbe-destination-description');
    const description = descInput ? descInput.value.trim() : '';

    return {
      url: link || urlFromBuilder,
      media: media,
      description: description || descFromBuilder
    };
  }

  function callCreatePin(params) {
    if (!window.__pbe_PinterestApi || !window.__pbe_PinterestApi.createPin) {
      return Promise.reject(new Error('Pinterest API helper not loaded.'));
    }
    return window.__pbe_PinterestApi.createPin(params);
  }

  const previousOpen = window.open;

  window.open = function (rawUrl, name, features) {
    if (typeof rawUrl !== 'string' ||
        rawUrl.indexOf('pinterest.com/pin/create/extension/') === -1) {
      return previousOpen.call(window, rawUrl, name, features);
    }

    // Read the manual destination link / description straight from the
    // popup inputs (the link / description patches rewrite URL params inside
    // the chain that runs after us, so rawUrl still has the bundle defaults).
    const fromUrl = readManualParams(rawUrl);

    // Pull title and board from their respective patch helpers.
    const titleGetter = window.__pbe_getManualTitle;
    const boardGetter = window.__pbe_getManualBoard;
    const title = (titleGetter ? titleGetter({ consume: false }) : '') || '';
    const board = boardGetter ? boardGetter() : null;

    if (!fromUrl.media || !fromUrl.url) {
      // Nothing to pin via API; let the tab flow take over silently.
      return previousOpen.call(window, rawUrl, name, features);
    }

    if (!board || !board.id) {
      // Either the user didn't pick a board, or the cached board list
      // doesn't contain that name (so we don't have an id). Fall through
      // to the tab flow so they can pick a board on Pinterest.
      if (board && board.name && !board.id) {
        showToast(
          'Board "' + board.name + '" not found in your boards cache. ' +
          'Click Refresh next to the Board field, then try again. ' +
          'Falling back to Pinterest tab for this save.',
          'info'
        );
      }
      return previousOpen.call(window, rawUrl, name, features);
    }

    showToast('Saving to "' + board.name + '"...', 'info');

    // Kick off the API call. Return null so bundle.js doesn't get a window
    // reference (we don't want a tab to open on success).
    callCreatePin({
      board_id: board.id,
      image_url: fromUrl.media,
      link: fromUrl.url,
      description: fromUrl.description,
      title: title
    }).then(function (result) {
      const url = result && result.url
        ? 'https://www.pinterest.com' + (result.url.charAt(0) === '/' ? result.url : '/' + result.url)
        : null;
      showToast(
        'Pinned to "' + board.name + '" \u2713' + (url ? '  -  ' + url : ''),
        'success'
      );
      // Consume the title and board so the next pin starts fresh.
      if (window.__pbe_getManualTitle) window.__pbe_getManualTitle({ consume: true });
      if (window.__pbe_consumeManualBoard) window.__pbe_consumeManualBoard();
    }).catch(function (err) {
      console.warn('[pbe] createPin failed, falling back to tab flow:', err);
      showToast(
        'Direct save failed (' + (err && err.message ? err.message : 'unknown') +
        '). Opening Pinterest tab as fallback...',
        'error'
      );
      // Fall back: open Pinterest's pin builder so the user can complete
      // the save manually. Use setTimeout so the toast renders before the
      // tab steals focus.
      setTimeout(function () {
        try { previousOpen.call(window, rawUrl, name, features); } catch (e) { /* ignore */ }
      }, 200);
    });

    return null;
  };
})();
