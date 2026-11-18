/* 统一 fetch 封装（契约 12.2）：
 * - 全部请求 credentials:'same-origin'；
 * - POST/PUT/PATCH 带 Content-Type: application/json；
 * - 401（会话失效 / 账户到期 / 停用）→ 清状态并跳 #/login，提示语带到期日期；
 *   例外：INVALID_PASSWORD（改密码旧密码错误）不视为会话失效；
 * - 非 2xx 读取 {error, message} 显示中文提示（可通过 toast:false 关闭自动 toast）；
 * - 网络异常统一提示“网络错误，请重试”。
 */
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(message, code, status, extra) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
      this.status = status || 0;
      this.extra = extra || {};
    }
  }

  function sessionEnding(status, code) {
    // 仅 401 且非“旧密码错误”视为会话终结
    return status === 401 && code !== 'INVALID_PASSWORD';
  }

  /**
   * opts: { method, body, signal, toast=false 关闭自动错误 toast,
   *         silent401=false 关闭 401 跳转前的提示 }
   */
  async function apiFetch(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.signal) init.signal = opts.signal;
    if (opts.body !== undefined && opts.body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    var res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      var netErr = new ApiError('网络错误，请重试', 'NETWORK', 0);
      if (opts.toast !== false) Store.toast(netErr.message, 'error');
      throw netErr;
    }

    var data = null;
    if (res.status !== 204) {
      try { data = await res.json(); } catch (e) { data = null; }
    }

    if (sessionEnding(res.status, data && data.error)) {
      var sessionMsg = (data && data.message) || '登录已过期，请重新登录';
      // 契约 12.2：到期提示语带到期日期
      if ((data && data.error) === 'ACCOUNT_EXPIRED' && data.extra && data.extra.expiry) {
        sessionMsg = '账户已于 ' + data.extra.expiry + ' 到期';
      }
      if (opts.silent401 !== true) Store.toast(sessionMsg, 'error');
      Store.clearAuth();
      Router.navigate('/login');
      throw new ApiError(sessionMsg, data && data.error, res.status, data && data.extra);
    }

    if (!res.ok) {
      var msg = (data && data.message) || ('请求失败（' + res.status + '）');
      if (opts.toast !== false) Store.toast(msg, 'error');
      throw new ApiError(msg, data && data.error, res.status, data && data.extra);
    }

    return data;
  }

  /* ---------------- 接口定义 ---------------- */

  var api = {
    /* 认证 */
    status: function () { return apiFetch('/api/auth/status', { toast: false }); },
    me: function (opts) { return apiFetch('/api/auth/me', opts || { toast: false, silent401: true }); },
    setup: function (username, password) {
      return apiFetch('/api/auth/setup', { method: 'POST', body: { username: username, password: password }, toast: false });
    },
    register: function (username, password) {
      return apiFetch('/api/auth/register', { method: 'POST', body: { username: username, password: password }, toast: false });
    },
    login: function (username, password) {
      return apiFetch('/api/auth/login', { method: 'POST', body: { username: username, password: password }, toast: false });
    },
    logout: function () { return apiFetch('/api/auth/logout', { method: 'POST', toast: false, silent401: true }); },
    /* 在线状态（契约 28）：心跳上报，保持在线 */
    heartbeat: function () { return apiFetch('/api/auth/heartbeat', { method: 'POST', toast: false, silent401: true }); },
    changePassword: function (oldPassword, newPassword) {
      return apiFetch('/api/auth/password', { method: 'POST', body: { oldPassword: oldPassword, newPassword: newPassword }, toast: false });
    },

    /* 人设 */
    personas: function () { return apiFetch('/api/personas'); },
    persona: function (id) { return apiFetch('/api/personas/' + encodeURIComponent(id)); },
    createPersona: function (data) { return apiFetch('/api/personas', { method: 'POST', body: data, toast: false }); },
    updatePersona: function (id, data) {
      return apiFetch('/api/personas/' + encodeURIComponent(id), { method: 'PUT', body: data, toast: false });
    },
    deletePersona: function (id) { return apiFetch('/api/personas/' + encodeURIComponent(id), { method: 'DELETE' }); },
    /* 角色头像（契约 26）：POST {dataUrl} → {persona:{...,avatarUrl}}；DELETE → 204 */
    uploadPersonaAvatar: function (id, dataUrl) {
      return apiFetch('/api/personas/' + encodeURIComponent(id) + '/avatar', { method: 'POST', body: { dataUrl: dataUrl }, toast: false });
    },
    deletePersonaAvatar: function (id) {
      return apiFetch('/api/personas/' + encodeURIComponent(id) + '/avatar', { method: 'DELETE', toast: false });
    },
    /* 人设文件导入（契约 27）：POST {filename, dataBase64} → {content, filename, format, warnings} */
    importPersonaFile: function (filename, dataBase64) {
      return apiFetch('/api/personas/import-file', { method: 'POST', body: { filename: filename, dataBase64: dataBase64 }, toast: false });
    },

    /* 聊天 */
    chats: function () { return apiFetch('/api/chats'); },
    chat: function (id) { return apiFetch('/api/chats/' + encodeURIComponent(id)); },
    /* POST body 透传：{personaId, title?, model?, selfPersona?, saveSelfPersonaAsDefault?}（契约 19） */
    createChat: function (data) { return apiFetch('/api/chats', { method: 'POST', body: data }); },
    /* PATCH body 透传：{title?, selfPersona?, saveAsDefault?}（契约 19） */
    updateChat: function (id, data) {
      return apiFetch('/api/chats/' + encodeURIComponent(id), { method: 'PATCH', body: data });
    },
    deleteChat: function (id) { return apiFetch('/api/chats/' + encodeURIComponent(id), { method: 'DELETE' }); },
    /* 聊天压缩（契约 16.1）：POST /api/chats/:id/summarize，body 可选 {keepRecent}，200 {chat,summary,removedCount} */
    summarizeChat: function (id, opts) {
      var body;
      if (opts && typeof opts.keepRecent === 'number') body = { keepRecent: opts.keepRecent };
      return apiFetch('/api/chats/' + encodeURIComponent(id) + '/summarize', { method: 'POST', body: body, toast: false });
    },
    /* 聊天文档（契约 18） */
    uploadDocument: function (chatId, data) {
      return apiFetch('/api/chats/' + encodeURIComponent(chatId) + '/documents', { method: 'POST', body: data, toast: false });
    },
    analyzeDocument: function (chatId, docId) {
      return apiFetch('/api/chats/' + encodeURIComponent(chatId) + '/documents/' + encodeURIComponent(docId) + '/analyze',
        { method: 'POST', body: {}, toast: false });
    },
    applyDocument: function (chatId, docId, snippet) {
      return apiFetch('/api/chats/' + encodeURIComponent(chatId) + '/documents/' + encodeURIComponent(docId) + '/apply',
        { method: 'POST', body: { snippet: snippet }, toast: false });
    },

    /* 设置 */
    settings: function () { return apiFetch('/api/settings'); },
    updateSettings: function (data) { return apiFetch('/api/settings', { method: 'PUT', body: data, toast: false }); },
    models: function () { return apiFetch('/api/models'); },
    testKey: function (apiKey) {
      return apiFetch('/api/settings/test-key', { method: 'POST', body: apiKey ? { apiKey: apiKey } : {}, toast: false });
    },

    /* 导入 */
    importFetch: function (url) { return apiFetch('/api/import/fetch', { method: 'POST', body: { url: url }, toast: false }); },
    importExtract: function (transcript, title) {
      var body = { transcript: transcript };
      if (title) body.title = title;
      return apiFetch('/api/import/extract', { method: 'POST', body: body, toast: false });
    },

    /* 管理 */
    adminAccounts: function () { return apiFetch('/api/admin/accounts'); },
    adminCreateAccount: function (data) { return apiFetch('/api/admin/accounts', { method: 'POST', body: data, toast: false }); },
    adminUpdateAccount: function (username, data) {
      return apiFetch('/api/admin/accounts/' + encodeURIComponent(username), { method: 'PATCH', body: data, toast: false });
    },
    adminDeleteAccount: function (username) {
      return apiFetch('/api/admin/accounts/' + encodeURIComponent(username), { method: 'DELETE' });
    },
    adminSettings: function () { return apiFetch('/api/admin/settings'); },
    adminUpdateSettings: function (data) { return apiFetch('/api/admin/settings', { method: 'PATCH', body: data }); },
    /* 在线用户（契约 22）：GET /api/admin/online → {online:[{username,role,loginAt,lastSeenAt,expiry}],count} */
    adminOnline: function () { return apiFetch('/api/admin/online'); },
    /* 监管查看（契约 23）：GET /api/admin/users/:username/chats[/:chatId] */
    adminUserChats: function (username) {
      return apiFetch('/api/admin/users/' + encodeURIComponent(username) + '/chats');
    },
    adminUserChat: function (username, chatId) {
      return apiFetch('/api/admin/users/' + encodeURIComponent(username) + '/chats/' + encodeURIComponent(chatId));
    },
    /* 查看用户人设（契约 25）：GET /api/admin/users/:username/personas[/:personaId] */
    adminUserPersonas: function (username) {
      return apiFetch('/api/admin/users/' + encodeURIComponent(username) + '/personas');
    },
    adminUserPersona: function (username, personaId) {
      return apiFetch('/api/admin/users/' + encodeURIComponent(username) + '/personas/' + encodeURIComponent(personaId));
    },
  };

  /**
   * 流式聊天（契约 8.1）：POST /api/chats/:id/messages
   * 逐行解析 `data: <JSON>`，事件：meta / delta / done / error。
   * handlers: { onMeta(evt), onDelta(evt), onDone(evt), onError(evt) }
   * 用户停止（AbortController）时抛出 AbortError。
   */
  async function streamChat(id, content, handlers, signal) {
    handlers = handlers || {};
    var res;
    try {
      res = await fetch('/api/chats/' + encodeURIComponent(id) + '/messages', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
        signal: signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      var netErr = new ApiError('网络错误，请重试', 'NETWORK', 0);
      Store.toast(netErr.message, 'error');
      throw netErr;
    }

    if (res.status === 401) {
      var d401 = null;
      try { d401 = await res.json(); } catch (e) { d401 = null; }
      var sessionMsg = (d401 && d401.message) || '登录已过期，请重新登录';
      if ((d401 && d401.error) === 'ACCOUNT_EXPIRED' && d401.extra && d401.extra.expiry) {
        sessionMsg = '账户已于 ' + d401.extra.expiry + ' 到期';
      }
      Store.toast(sessionMsg, 'error');
      Store.clearAuth();
      Router.navigate('/login');
      throw new ApiError(sessionMsg, d401 && d401.error, res.status, d401 && d401.extra);
    }

    if (!res.ok) {
      // NO_API_KEY（400 普通 JSON）等，不进入流
      var derr = null;
      try { derr = await res.json(); } catch (e) { derr = null; }
      var errMsg = (derr && derr.message) || ('发送失败（' + res.status + '）');
      throw new ApiError(errMsg, derr && derr.error, res.status, derr && derr.extra);
    }

    var ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('text/event-stream') >= 0) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = processLines(buffer, handlers);
      }
      if (buffer.trim()) processLines(buffer + '\n', handlers);
    } else {
      // 兜底：非流式 JSON 响应
      var dj = null;
      try { dj = await res.json(); } catch (e) { dj = null; }
      if (!dj) throw new ApiError('响应格式异常', 'BAD_RESPONSE', res.status);
      if (dj.type === 'error' && handlers.onError) handlers.onError(dj);
      else if (dj.message) handlers.onDone({ type: 'done', message: dj.message });
      else throw new ApiError('响应格式异常', 'BAD_RESPONSE', res.status);
    }
  }

  /** 逐行解析 SSE 缓冲，返回剩余缓冲 */
  function processLines(buffer, handlers) {
    var idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      var line = buffer.slice(0, idx).replace(/\r$/, '').trim();
      buffer = buffer.slice(idx + 1);
      if (line.slice(0, 5) !== 'data:') continue;
      var payload = line.slice(5).trim();
      if (!payload) continue;
      var evt = null;
      try { evt = JSON.parse(payload); } catch (e) { continue; }
      if (!evt || !evt.type) continue;
      if (evt.type === 'meta' && handlers.onMeta) handlers.onMeta(evt);
      else if (evt.type === 'delta' && handlers.onDelta) handlers.onDelta(evt);
      else if (evt.type === 'done' && handlers.onDone) handlers.onDone(evt);
      else if (evt.type === 'error' && handlers.onError) handlers.onError(evt);
    }
    return buffer;
  }

  /* ---------------- 全局动作 ---------------- */

  window.AppActions = {
    /** 退出登录：调后端 204 后清本地状态并回登录页 */
    async logout() {
      try { await api.logout(); } catch (e) { /* 忽略：本地一律清状态 */ }
      Store.clearAuth();
      Router.navigate('/login');
    },
  };

  window.Api = { apiFetch: apiFetch, api: api, streamChat: streamChat, ApiError: ApiError };
})();
