/*
 * pinterestInternalApi.js
 *
 * Cookie-authenticated wrapper for Pinterest's internal /resource/... API.
 * Reuses the user's already-logged-in pinterest.com session via the
 * `cookies` + `host_permissions` already declared in manifest.json.
 *
 * No OAuth, no developer app, no tokens. The csrftoken cookie value is
 * read via chrome.cookies.get and sent as X-CSRFToken; the session cookie
 * is sent automatically because fetch is called with credentials:'include'
 * and the extension has host_permissions for pinterest.com.
 *
 * These endpoints are internal/undocumented but stable (the official
 * Pinterest browser extensions have used them for years). On any error,
 * callers should fall back to the existing tab-based flow.
 *
 * Exposes window.__pbe_PinterestApi = { getBoards, createPin, ready }.
 */
(function () {
  'use strict';

  const ORIGIN = 'https://www.pinterest.com';
  const RESOURCE = ORIGIN + '/resource';

  function getCsrfToken() {
    return new Promise(function (resolve, reject) {
      if (typeof chrome === 'undefined' || !chrome.cookies || !chrome.cookies.get) {
        reject(new Error('chrome.cookies API not available (only works in extension page).'));
        return;
      }
      chrome.cookies.get({ url: ORIGIN + '/', name: 'csrftoken' }, function (cookie) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'cookie read failed'));
          return;
        }
        if (!cookie || !cookie.value) {
          reject(new Error('No csrftoken cookie found - sign in to pinterest.com first.'));
          return;
        }
        resolve(cookie.value);
      });
    });
  }

  function getSessionCookie() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.cookies || !chrome.cookies.get) {
        resolve(null);
        return;
      }
      chrome.cookies.get({ url: ORIGIN + '/', name: '_pinterest_sess' }, function (cookie) {
        resolve(cookie && cookie.value ? cookie.value : null);
      });
    });
  }

  /*
   * Common headers used for every /resource/... call. credentials:'include'
   * sends the auth cookies; X-CSRFToken proves cross-origin intent.
   */
  function commonHeaders(csrf) {
    return {
      'X-CSRFToken': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Pinterest-AppState': 'active',
      'X-Pinterest-Source-Url': '/',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    };
  }

  function callResource(path, method, dataObj) {
    return getCsrfToken().then(function (csrf) {
      const url = RESOURCE + path;
      const data = JSON.stringify({ options: dataObj || {}, context: {} });
      const init = {
        method: method,
        credentials: 'include',
        mode: 'cors',
        headers: commonHeaders(csrf)
      };
      if (method === 'GET') {
        const qs = '?source_url=/&data=' + encodeURIComponent(data);
        return fetch(url + qs, init).then(parseResponse);
      } else {
        const body = new URLSearchParams();
        body.set('source_url', '/');
        body.set('data', data);
        init.body = body.toString();
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        return fetch(url, init).then(parseResponse);
      }
    });
  }

  function parseResponse(response) {
    return response.text().then(function (text) {
      let body = null;
      try { body = JSON.parse(text); } catch (e) { /* keep raw text */ }
      if (!response.ok) {
        const msg = (body && (body.message || body.error || (body.resource_response && body.resource_response.message))) ||
                    ('HTTP ' + response.status);
        const err = new Error(msg);
        err.status = response.status;
        err.body = body || text;
        throw err;
      }
      const inner = body && body.resource_response;
      if (inner && inner.status && inner.status !== 'success') {
        const err = new Error(inner.message || ('Pinterest API status: ' + inner.status));
        err.status = response.status;
        err.body = body;
        throw err;
      }
      return body;
    });
  }

  /*
   * GET /resource/BoardsResource/get/ — returns the signed-in user's boards.
   * field_set_key:'board_picker' returns the lightweight shape used by
   * Pinterest's own pin-builder UI: id, name, privacy, image_thumbnail_url.
   */
  function getBoards() {
    return callResource('/BoardsResource/get/', 'GET', {
      privacy_filter: 'all',
      sort: 'alphabetical',
      filter: 'all',
      field_set_key: 'board_picker',
      page_size: 250
    }).then(function (body) {
      const list = body && body.resource_response && body.resource_response.data;
      if (!Array.isArray(list)) return [];
      return list.map(function (b) {
        return {
          id: String(b.id || b.board_id || ''),
          name: String(b.name || ''),
          url: b.url || '',
          privacy: b.privacy || '',
          image: (b.image_thumbnail_url || b.image_cover_url || (Array.isArray(b.cover_images) && b.cover_images[0] && b.cover_images[0].url) || '')
        };
      }).filter(function (b) { return b.id && b.name; });
    });
  }

  /*
   * POST /resource/PinResource/create/ — creates a pin on the given board.
   * Required fields: board_id, image_url. Optional: title, description, link.
   */
  function createPin(opts) {
    if (!opts || !opts.board_id) return Promise.reject(new Error('createPin: board_id required'));
    if (!opts.image_url) return Promise.reject(new Error('createPin: image_url required'));
    const payload = {
      board_id: String(opts.board_id),
      image_url: String(opts.image_url),
      description: opts.description ? String(opts.description) : '',
      title: opts.title ? String(opts.title) : '',
      link: opts.link ? String(opts.link) : '',
      method: 'scraped',
      is_video: false
    };
    return callResource('/PinResource/create/', 'POST', payload).then(function (body) {
      const data = body && body.resource_response && body.resource_response.data;
      const id = data && (data.id || data.pin_id);
      return {
        id: id ? String(id) : null,
        url: data && data.url ? data.url : null,
        raw: data
      };
    });
  }

  function isLoggedIn() {
    return getSessionCookie().then(function (sess) {
      return !!sess;
    });
  }

  window.__pbe_PinterestApi = {
    getBoards: getBoards,
    createPin: createPin,
    isLoggedIn: isLoggedIn,
    ORIGIN: ORIGIN
  };
})();
