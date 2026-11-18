/* 手写 hash 路由（契约 12.1）：监听 hashchange，无 vue-router。
 * 路由表：#/ 、#/chat/<id> 、#/setup 、#/login 、#/personas 、#/import 、#/settings 、#/admin
 */
(function () {
  'use strict';

  var VALID = ['chat', 'setup', 'login', 'personas', 'import', 'settings', 'admin'];

  var state = Vue.reactive({
    name: 'chat',   // 当前路由名
    param: null,    // 仅 chat 路由：聊天 id
  });

  function parseHash() {
    var raw = location.hash || '#/';
    var parts = raw.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    var name = VALID.indexOf(parts[0]) >= 0 ? parts[0] : 'chat';
    state.name = name;
    state.param = (name === 'chat' && parts[1]) ? parts[1] : null;
  }

  /**
   * 编程式导航。path 形如 '/'、'/login'、'/chat/<id>'、'/admin'。
   * 相同目标时强制重新解析（用于主动刷新）。
   */
  function navigate(path) {
    path = path || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    var target = '#' + path;
    if (location.hash === target) {
      parseHash();
    } else {
      location.hash = path;
    }
  }

  window.addEventListener('hashchange', parseHash);
  parseHash();

  window.Router = { state: state, parseHash: parseHash, navigate: navigate };
})();
