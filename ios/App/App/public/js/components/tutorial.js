/* 使用教程弹窗（tpl-tutorial）：打开时拉取 /tutorial.md，用 marked + DOMPurify 渲染。
 * 内容为静态教程文档，渲染结果已消毒。
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.TutorialModal = {
    template: '#tpl-tutorial',
    data: function () {
      return {
        loading: true,
        error: '',
        html: '',
      };
    },
    async mounted() {
      try {
        var res = await fetch('/tutorial.md', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var text = await res.text();
        this.html = MarkdownUtils.render(text);
        this.loading = false;
      } catch (e) {
        this.loading = false;
        this.error = '教程加载失败，请稍后重试';
      }
    },
    methods: {
      close: function () {
        this.$emit('close');
      },
    },
  };
})();
