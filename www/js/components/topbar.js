/* 顶栏：品牌、导航、用户名、状态徽标、到期倒计时、退出登录（模板 #tpl-topbar）。
 * 到期倒计时：server.time 与本地时钟的偏移（Store.serverNowMs）+ ticker 刷新。
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.TopBar = {
    template: '#tpl-topbar',
    emits: ['toggle-nav'],
    computed: {
      user: function () { return Store.state.user; },
      routeName: function () { return Router.state.name; },
      statusText: function () { return Store.statusText(this.user); },
      statusClass: function () { return Store.statusClass(this.user); },
      expiryText: function () {
        var u = this.user;
        if (!u || !u.expiry) return '';
        // 依赖 nowMs ticker，每分钟重算
        void Store.state.nowMs;
        var tz = (Store.state.server && Store.state.server.timezone) || 'Asia/Shanghai';
        if (u.expired || u.status === 'expired') return '有效期至 ' + u.expiry + '（已到期）';
        var left = TimeUtils.daysLeft(u.expiry, tz, Store.serverNowMs());
        if (left == null) return '有效期至 ' + u.expiry;
        if (left <= 0) return '有效期至 ' + u.expiry + '（已到期）';
        return '有效期至 ' + u.expiry + '（剩 ' + left + ' 天）';
      },
    },
    methods: {
      logout: function () { AppActions.logout(); },
      openTutorial: function () {
        if (this.$root && typeof this.$root.openTutorial === 'function') this.$root.openTutorial();
      },
    },
  };
})();
