/* 首次初始化管理员（#/setup）：POST /api/auth/setup */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.SetupView = {
    template: '#tpl-setup',
    data: function () {
      return {
        username: 'admin',
        password: '',
        confirm: '',
        error: '',
        busy: false,
      };
    },
    computed: {
      canSubmit: function () {
        return !!(this.username.trim() && this.password && this.confirm);
      },
    },
    methods: {
      validate: function () {
        var u = this.username.trim();
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(u)) {
          return '用户名需为 2-24 位字母、数字、下划线或中文';
        }
        if ((this.password || '').length < 6) return '密码至少 6 位';
        if (this.password !== this.confirm) return '两次输入的密码不一致';
        return '';
      },
      submit: async function () {
        var err = this.validate();
        if (err) { this.error = err; return; }
        this.error = '';
        this.busy = true;
        try {
          var data = await Api.api.setup(this.username.trim(), this.password);
          Store.setUser(data.user);
          Store.toast('初始化完成，欢迎使用！', 'ok');
          Router.navigate('/');
        } catch (e) {
          this.error = (e && e.message) ? e.message : '网络错误，请重试';
        } finally {
          this.busy = false;
        }
      },
    },
  };
})();
