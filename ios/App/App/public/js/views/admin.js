/* 管理面板（#/admin，仅 admin 可访问；路由守卫兜底）：
 * - 账户表格：用户名/角色/状态徽标/到期日/最近登录/人设数/聊天数/操作；
 * - 操作：设到期日（date input）、停用/启用、重置密码、删除（禁止删自己）；
 * - 新建账户（用户名/密码/可选到期日）；
 * - 注册开关（GET/PATCH /api/admin/settings）；
 * - 在线用户（契约 22：GET /api/admin/online，30 秒自动刷新）；
 * - 监管查看用户聊天（契约 23：GET /api/admin/users/:username/chats[/:chatId]，只读弹窗）；
 * - 查看用户人设（契约 25：GET /api/admin/users/:username/personas[/:personaId]，只读弹窗）。
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.AdminView = {
    template: '#tpl-admin',
    data: function () {
      return {
        accounts: [],
        loading: true,
        loadError: '',
        allowRegistration: true,
        regSaving: false,
        create: { username: '', password: '', expiry: '' },
        createError: '',
        creating: false,
        reset: null,
        resetPassword: '',
        resetError: '',
        resetting: false,
        /* 在线用户（契约 22） */
        online: [],
        onlineCount: 0,
        onlineLoading: false,
        onlineError: '',
        onlineTimer: null,
        /* 监管查看（契约 23） */
        viewerOpen: false,
        viewer: {
          username: '',
          chats: [],
          loadingList: false,
          listError: '',
          activeChat: null,
          loadingChat: false,
          chatError: '',
        },
        /* 查看用户人设（契约 25） */
        personaViewerOpen: false,
        personaViewer: {
          username: '',
          personas: [],
          loadingList: false,
          listError: '',
          active: null,
          loadingDetail: false,
          detailError: '',
        },
      };
    },
    computed: {
      me: function () { return Store.state.user; },
    },
    async mounted() {
      await this.loadAll();
      this.loadOnline();
      this.startOnlineTimer();
    },
    beforeUnmount() {
      this.stopOnlineTimer();
    },
    methods: {
      loadAll: async function () {
        this.loading = true;
        this.loadError = '';
        try {
          var results = await Promise.all([Api.api.adminAccounts(), Api.api.adminSettings()]);
          this.accounts = (results[0] && results[0].accounts) || [];
          this.allowRegistration = !!(results[1] && results[1].allowRegistration);
        } catch (e) {
          this.loadError = (e && e.message) || '加载失败';
        } finally {
          this.loading = false;
        }
      },
      /* ----- 在线用户（契约 22）----- */
      loadOnline: async function () {
        this.onlineLoading = true;
        this.onlineError = '';
        try {
          var d = await Api.api.adminOnline();
          this.online = (d && d.online) || [];
          this.onlineCount = (typeof d.count === 'number') ? d.count : this.online.length;
        } catch (e) {
          this.onlineError = (e && e.message) || '加载失败';
        } finally {
          this.onlineLoading = false;
        }
      },
      startOnlineTimer: function () {
        if (this.onlineTimer) return;
        var self = this;
        this.onlineTimer = setInterval(function () {
          if (!self.onlineLoading) self.loadOnline();
        }, 30000);
      },
      stopOnlineTimer: function () {
        if (this.onlineTimer) {
          clearInterval(this.onlineTimer);
          this.onlineTimer = null;
        }
      },
      /* ----- 监管查看用户聊天（契约 23，只读）----- */
      openChatViewer: function (username) {
        this.viewer = {
          username: username,
          chats: [],
          loadingList: false,
          listError: '',
          activeChat: null,
          loadingChat: false,
          chatError: '',
        };
        this.viewerOpen = true;
        this.loadUserChats();
      },
      closeChatViewer: function () {
        this.viewerOpen = false;
      },
      loadUserChats: async function () {
        var v = this.viewer;
        if (!v || !v.username) return;
        v.loadingList = true;
        v.listError = '';
        try {
          var d = await Api.api.adminUserChats(v.username);
          v.chats = (d && d.chats) || [];
        } catch (e) {
          v.listError = (e && e.message) || '加载失败';
        } finally {
          v.loadingList = false;
        }
      },
      openUserChat: async function (c) {
        var v = this.viewer;
        if (!v) return;
        v.loadingChat = true;
        v.chatError = '';
        v.activeChat = null;
        try {
          var d = await Api.api.adminUserChat(v.username, c.id);
          var chat = d && d.chat;
          if (!chat) throw new Error('聊天不存在');
          chat.messages = chat.messages || [];
          v.activeChat = chat;
        } catch (e) {
          v.chatError = (e && e.message) || '加载失败';
        } finally {
          v.loadingChat = false;
        }
      },
      backToChatList: function () {
        if (this.viewer) {
          this.viewer.activeChat = null;
          this.viewer.chatError = '';
        }
      },
      /* ----- 查看用户人设（契约 25，只读）----- */
      openPersonaViewer: function (username) {
        this.personaViewer = {
          username: username,
          personas: [],
          loadingList: false,
          listError: '',
          active: null,
          loadingDetail: false,
          detailError: '',
        };
        this.personaViewerOpen = true;
        this.loadUserPersonas();
      },
      closePersonaViewer: function () {
        this.personaViewerOpen = false;
      },
      loadUserPersonas: async function () {
        var v = this.personaViewer;
        if (!v || !v.username) return;
        v.loadingList = true;
        v.listError = '';
        try {
          var d = await Api.api.adminUserPersonas(v.username);
          v.personas = (d && d.personas) || [];
        } catch (e) {
          v.listError = (e && e.message) || '加载失败';
        } finally {
          v.loadingList = false;
        }
      },
      openUserPersona: async function (p) {
        var v = this.personaViewer;
        if (!v) return;
        v.loadingDetail = true;
        v.detailError = '';
        v.active = null;
        try {
          var d = await Api.api.adminUserPersona(v.username, p.id);
          var persona = d && d.persona;
          if (!persona) throw new Error('人设不存在');
          persona.content = persona.content || '';
          persona.attributes = persona.attributes || [];
          persona.stateAttributes = persona.stateAttributes || [];
          persona.stateEnabled = !!persona.stateEnabled;
          v.active = persona;
        } catch (e) {
          v.detailError = (e && e.message) || '加载失败';
        } finally {
          v.loadingDetail = false;
        }
      },
      backToPersonaList: function () {
        if (this.personaViewer) {
          this.personaViewer.active = null;
          this.personaViewer.detailError = '';
        }
      },
      isSelf: function (username) {
        return !!(this.me && this.me.username === username);
      },
      /** 契约 24：管理员账户时效豁免 */
      isAdminAccount: function (username) {
        var row = (this.accounts || []).find(function (x) { return x.username === username; });
        return !!(row && row.role === 'admin');
      },
      statusText: function (a) { return Store.statusText(a); },
      statusClass: function (a) { return Store.statusClass(a); },
      setExpiry: async function (username, value) {
        var expiry = (value || '').trim() ? value : null;
        if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
          Store.toast('到期日格式应为 YYYY-MM-DD', 'error');
          return;
        }
        // 契约 24：管理员不设到期时间（仅允许 null 清除脏数据；UI 已不提供入口，此为防御）
        if (this.isAdminAccount(username) && expiry) {
          Store.toast('管理员账户不设到期时间', 'error');
          return;
        }
        try {
          await Api.api.adminUpdateAccount(username, { expiry: expiry });
          Store.toast(expiry ? '已更新「' + username + '」的到期日' : '已将「' + username + '」设为永久有效', 'ok');
          await this.loadAll();
        } catch (e) { /* toast 已弹出 */ }
      },
      toggleDisabled: async function (a) {
        // 契约 24：管理员不可停用（防御；UI 按钮已禁用）
        if (a && a.role === 'admin') {
          Store.toast('管理员账户不可停用', 'error');
          return;
        }
        var disabled = !a.disabled;
        try {
          await Api.api.adminUpdateAccount(a.username, { disabled: disabled });
          Store.toast(disabled ? '已停用「' + a.username + '」' : '已启用「' + a.username + '」', 'ok');
          await this.loadAll();
        } catch (e) { /* toast 已弹出 */ }
      },
      openReset: function (username) {
        this.reset = username;
        this.resetPassword = '';
        this.resetError = '';
      },
      submitReset: async function () {
        if (!this.reset) return;
        if ((this.resetPassword || '').length < 6) {
          this.resetError = '密码至少 6 位';
          return;
        }
        this.resetting = true;
        this.resetError = '';
        try {
          await Api.api.adminUpdateAccount(this.reset, { password: this.resetPassword });
          Store.toast('已重置「' + this.reset + '」的密码', 'ok');
          this.reset = null;
        } catch (e) {
          this.resetError = (e && e.message) || '重置失败';
        } finally {
          this.resetting = false;
        }
      },
      remove: async function (username) {
        if (this.isSelf(username)) return;
        // 契约 24：管理员不可删除（防御；UI 按钮已禁用）
        if (this.isAdminAccount(username)) {
          Store.toast('管理员账户不可删除', 'error');
          return;
        }
        if (!window.confirm('确定删除账户「' + username + '」？该账户的全部人设与聊天记录将一并删除，不可恢复！')) return;
        try {
          await Api.api.adminDeleteAccount(username);
          Store.toast('账户已删除', 'ok');
          await this.loadAll();
        } catch (e) { /* toast 已弹出 */ }
      },
      createAccount: async function () {
        var username = this.create.username.trim();
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(username)) {
          this.createError = '用户名需为 2-24 位字母、数字、下划线或中文';
          return;
        }
        if ((this.create.password || '').length < 6) {
          this.createError = '密码至少 6 位';
          return;
        }
        var expiry = (this.create.expiry || '').trim();
        if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
          this.createError = '到期日格式应为 YYYY-MM-DD';
          return;
        }
        this.creating = true;
        this.createError = '';
        try {
          var body = { username: username, password: this.create.password };
          if (expiry) body.expiry = expiry;
          await Api.api.adminCreateAccount(body);
          Store.toast('账户已创建', 'ok');
          this.create = { username: '', password: '', expiry: '' };
          await this.loadAll();
        } catch (e) {
          this.createError = (e && e.message) || '创建失败';
        } finally {
          this.creating = false;
        }
      },
      toggleRegistration: async function () {
        this.regSaving = true;
        try {
          var d = await Api.api.adminUpdateSettings({ allowRegistration: this.allowRegistration });
          this.allowRegistration = !!d.allowRegistration;
          Store.toast(this.allowRegistration ? '已开启注册' : '已关闭注册', 'ok');
        } catch (e) {
          // 失败时回退开关状态
          this.allowRegistration = !this.allowRegistration;
        } finally {
          this.regSaving = false;
        }
      },
    },
  };
})();
