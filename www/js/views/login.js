/* 登录 / 注册（#/login）。
 * - allowRegistration=false 时隐藏注册 tab（挂载时刷新 /api/auth/status）；
 * - 错误统一用接口返回的中文 message；
 * - ACCOUNT_EXPIRED 显示“账户已于 YYYY-MM-DD 到期”（extra.expiry）。
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.LoginView = {
    template: '#tpl-login',
    data: function () {
      return {
        tab: 'login',
        username: '',
        password: '',
        confirm: '',
        error: '',
        busy: false,
        allowRegistration: !!Store.state.allowRegistration,
      };
    },
    computed: {
      canSubmit: function () {
        if (!this.username.trim() || !this.password) return false;
        if (this.tab === 'register' && !this.confirm) return false;
        return true;
      },
    },
    async mounted() {
      // 刷新注册开关（管理员可能在面板里改过）
      try {
        var st = await Api.api.status();
        this.allowRegistration = !!st.allowRegistration;
        Store.state.allowRegistration = !!st.allowRegistration;
        if (st.server) Store.setServer(st.server);
      } catch (e) { /* 保持默认值 */ }
    },
    methods: {
      switchTab: function (t) {
        this.tab = t;
        this.error = '';
      },
      validate: function () {
        var u = this.username.trim();
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(u)) {
          return '用户名需为 2-24 位字母、数字、下划线或中文';
        }
        if ((this.password || '').length < 6) return '密码至少 6 位';
        if (this.tab === 'register' && this.password !== this.confirm) {
          return '两次输入的密码不一致';
        }
        return '';
      },
      errorText: function (e) {
        var code = e && e.code;
        if (code === 'ACCOUNT_EXPIRED') {
          var expiry = (e.extra && e.extra.expiry) || '—';
          return '账户已于 ' + expiry + ' 到期';
        }
        if (e && e.message) return e.message;
        return '网络错误，请重试';
      },
      submit: async function () {
        var err = this.validate();
        if (err) { this.error = err; return; }
        this.error = '';
        this.busy = true;
        try {
          var data;
          if (this.tab === 'register') {
            data = await Api.api.register(this.username.trim(), this.password);
            Store.toast('注册成功，已自动登录', 'ok');
          } else {
            data = await Api.api.login(this.username.trim(), this.password);
          }
          Store.setUser(data.user);
          Router.navigate('/');
        } catch (e) {
          this.error = this.errorText(e);
        } finally {
          this.busy = false;
        }
      },
    },
  };
})();
