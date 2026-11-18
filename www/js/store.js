/* 全局响应式状态（Vue reactive），以及 toast 工具。 */
(function () {
  'use strict';

  var state = Vue.reactive({
    booted: false,          // 启动流程是否完成
    bootError: '',          // 启动失败信息
    loggedIn: false,
    setupRequired: false,
    allowRegistration: true,
    server: null,           // { time: 'ISO', timezone: 'Asia/Shanghai' }
    serverOffsetMs: 0,      // 服务端时间 - 本地时间（毫秒），用于到期倒计时
    user: null,             // 账户公开对象（契约 5 节 user 形状）
    nowMs: Date.now(),      // 本地时钟 ticker，配合偏移计算“现在”
    toasts: [],             // { id, message, type }
    docSuggestionEnabled: true, // 契约 18：上传文档后是否弹“加入人设”建议（GET /api/settings 同步）
  });

  var toastSeq = 0;

  /** 弹一个 toast；type: 'info' | 'ok' | 'error' */
  function toast(message, type) {
    type = type || 'info';
    var id = ++toastSeq;
    state.toasts.push({ id: id, message: String(message || ''), type: type });
    setTimeout(function () {
      dismissToast(id);
    }, 4200);
  }

  function dismissToast(id) {
    var i = state.toasts.findIndex(function (t) { return t.id === id; });
    if (i >= 0) state.toasts.splice(i, 1);
  }

  /** 记录服务端时间并刷新偏移 */
  function setServer(server) {
    if (!server || !server.time) return;
    state.server = server;
    var serverMs = Date.parse(server.time);
    if (!Number.isNaN(serverMs)) {
      state.serverOffsetMs = serverMs - Date.now();
    }
  }

  /** 服务端当前时刻（本地时钟 + 偏移） */
  function serverNowMs() {
    return Date.now() + state.serverOffsetMs;
  }

  /** 设置当前用户（登录/注册/初始化成功） */
  function setUser(user, server) {
    state.user = user || null;
    state.loggedIn = !!user;
    if (server) setServer(server);
    if (user) state.setupRequired = false;
  }

  /** 本地清除登录态（不调用后端） */
  function clearAuth() {
    state.user = null;
    state.loggedIn = false;
  }

  /** 状态文案：正常 / 已到期 / 已停用 */
  function statusText(user) {
    if (!user) return '';
    var s = user.status;
    if (s === 'expired' || user.expired) return '已到期';
    if (s === 'disabled' || user.disabled) return '已停用';
    return '正常';
  }

  /** 状态徽标样式：ok / danger / muted */
  function statusClass(user) {
    if (!user) return 'ok';
    var s = user.status;
    if (s === 'expired' || user.expired) return 'danger';
    if (s === 'disabled' || user.disabled) return 'muted';
    return 'ok';
  }

  window.Store = {
    state: state,
    toast: toast,
    dismissToast: dismissToast,
    setServer: setServer,
    setUser: setUser,
    clearAuth: clearAuth,
    serverNowMs: serverNowMs,
    statusText: statusText,
    statusClass: statusClass,
  };
})();
