/* 应用入口：启动流程、hash 路由守卫、全局组件注册、挂载。
 * 启动流程（契约 12.3）：GET /api/auth/status →
 *   setupRequired → #/setup；未登录 → #/login；已登录 → #/（并取 /api/auth/me 拿 user）。
 */
(function () {
  'use strict';

  var App = {
    template: '#tpl-app',
    data: function () {
      return {
        navOpen: false,
        tutorialOpen: false,
        iosHintVisible: false,
      };
    },
    computed: {
      booted: function () { return Store.state.booted; },
      bootErrorText: function () { return Store.state.bootError; },
      loggedIn: function () { return Store.state.loggedIn; },
      routeName: function () { return Router.state.name; },
      statusText: function () { return Store.statusText(Store.state.user); },
      statusClass: function () { return Store.statusClass(Store.state.user); },
      currentView: function () {
        var map = {
          setup: 'setup-view',
          login: 'login-view',
          chat: 'chat-view',
          personas: 'personas-view',
          import: 'import-view',
          settings: 'settings-view',
          admin: 'admin-view',
        };
        return map[Router.state.name] || 'chat-view';
      },
    },
    watch: {
      routeName: function () {
        this.applyGuards();
        this.navOpen = false;
      },
    },
    methods: {
      /* 路由守卫（契约 12.1/12.2） */
      applyGuards: function () {
        if (!Store.state.booted) return;
        var name = Router.state.name;
        if (Store.state.setupRequired && name !== 'setup') return Router.navigate('/setup');
        if (!Store.state.loggedIn && name !== 'login' && name !== 'setup') return Router.navigate('/login');
        if (Store.state.loggedIn && (name === 'login' || name === 'setup')) return Router.navigate('/');
        if (name === 'admin' && (!Store.state.user || Store.state.user.role !== 'admin')) {
          Store.toast('没有管理员权限', 'error');
          return Router.navigate('/');
        }
        if (name === 'setup' && !Store.state.setupRequired) {
          return Store.state.loggedIn ? Router.navigate('/') : Router.navigate('/login');
        }
      },
      retryBoot: function () {
        Store.state.bootError = '';
        Store.state.booted = false;
        this.boot();
      },
      logout: function () {
        AppActions.logout();
        this.navOpen = false;
      },
      openTutorial: function () {
        this.tutorialOpen = true;
        this.navOpen = false;
      },
      /* ----- iOS 安装引导（契约 33）----- */
      detectIosHint: function () {
        try {
          var ua = (typeof navigator !== 'undefined') ? (navigator.userAgent || '') : '';
          var standalone = (typeof navigator !== 'undefined' && typeof navigator.standalone === 'boolean')
            ? navigator.standalone : false;
          var dismissed = false;
          try { dismissed = localStorage.getItem('pc_ios_hint_dismissed') === '1'; } catch (e) { dismissed = false; }
          this.iosHintVisible = IosHint.shouldShow(ua, standalone, dismissed);
        } catch (e) {
          this.iosHintVisible = false;
        }
      },
      dismissIosHint: function () {
        this.iosHintVisible = false;
        try { localStorage.setItem('pc_ios_hint_dismissed', '1'); } catch (e) { /* 忽略 */ }
      },
      boot: async function () {
        Store.state.booted = false;
        try {
          var st = await Api.api.status();
          Store.state.setupRequired = !!st.setupRequired;
          Store.state.allowRegistration = (typeof st.allowRegistration === 'boolean')
            ? st.allowRegistration
            : true;
          if (st.server) Store.setServer(st.server);
          Store.state.loggedIn = !!st.loggedIn;
          if (st.loggedIn) {
            var user = st.user || null;
            if (!user) {
              // 契约 6：/api/auth/me 返回 { user, server }
              try {
                var me = await Api.api.me();
                if (me && me.user) user = me.user;
                if (me && me.server) Store.setServer(me.server);
              } catch (e) {
                user = null;
              }
            }
            if (user) {
              Store.setUser(user);
            } else {
              Store.clearAuth();
            }
          } else {
            Store.clearAuth();
          }
        } catch (e) {
          Store.state.bootError = (e && e.message) || '网络错误，请重试';
          Store.state.booted = true;
          return;
        }
        Store.state.booted = true;
        this.applyGuards();
      },
    },
    created: function () {
      this.boot();
      this.detectIosHint();
      /* 在线状态（契约 28）：登录状态下每 60 秒心跳一次，保持在线 */
      setInterval(function () {
        if (Store.state.loggedIn) {
          Api.api.heartbeat().catch(function () { /* 网络错误忽略 */ });
        }
      }, 60000);
      /* 页面关闭/刷新时用 sendBeacon 通知服务器标记离线（下次请求自动恢复在线） */
      var goOffline = function () {
        if (!Store.state.loggedIn) return;
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/auth/offline');
          } else {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/auth/offline', true);
            xhr.send();
          }
        } catch (e) { /* 忽略 */ }
      };
      window.addEventListener('pagehide', goOffline);
      window.addEventListener('beforeunload', goOffline);
    },
  };

  var app = Vue.createApp(App);

  /* 全局属性（模板内使用） */
  app.config.globalProperties.$S = Store;          // $S.state / $S.statusText / $S.dismissToast
  app.config.globalProperties.$time = TimeUtils;   // $time.fmtDateTime 等

  /* v-sanitize：marked + DOMPurify + 代码块复制 */
  MarkdownUtils.registerDirective(app);

  /* 全局组件 */
  app.component('toast-host', Views.ToastHost);
  app.component('top-bar', Views.TopBar);
  app.component('tutorial-modal', Views.TutorialModal);
  app.component('chat-list', Views.ChatList);
  app.component('new-chat-modal', Views.NewChatModal);
  app.component('setup-view', Views.SetupView);
  app.component('login-view', Views.LoginView);
  app.component('chat-view', Views.ChatView);
  app.component('personas-view', Views.PersonasView);
  app.component('import-view', Views.ImportView);
  app.component('settings-view', Views.SettingsView);
  app.component('admin-view', Views.AdminView);

  /* 到期倒计时 ticker：每分钟刷新（server.time 与本地时钟偏移计算） */
  setInterval(function () {
    Store.state.nowMs = Date.now();
  }, 60000);

  window.__app = app.mount('#app');
})();
