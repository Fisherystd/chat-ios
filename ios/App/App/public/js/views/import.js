/* 导入向导（#/import）三步：
 * ① 服务器版：输入下载地址 → POST /api/import/fetch；本机版：粘贴对话内容 → 直接 extract
 * ② 对话预览（滚动区 + 截断标注）→ 「提取人设」POST /api/import/extract
 * ③ 人设文本可编辑预览（source=llm/heuristic 与 warning 展示）→ 填名称 → POST /api/personas 保存
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.ImportView = {
    template: '#tpl-import',
    data: function () {
      return {
        step: 1,
        localMode: !!window.__LOCAL_MODE__,  // 契约 34：本机版粘贴导入（无 URL 抓取）
        url: '',
        pasted: '',
        fetching: false,
        step1Error: '',
        fetched: null,       // { kind, title, transcript, transcriptTruncated, bytes }
        extracting: false,
        step2Error: '',
        extracted: null,     // { suggestion, source, warning }
        name: '',
        content: '',
        saving: false,
        step3Error: '',
      };
    },
    computed: {
      canSave: function () {
        return this.name.trim().length > 0 && this.content.trim().length > 0;
      },
    },
    methods: {
      fetchTranscript: async function () {
        // 本机版（契约 34）：粘贴对话内容 → 直接 extract → 进入步骤 3 预览/编辑/保存
        if (this.localMode) {
          var text = (this.pasted || '').trim();
          if (!text) { this.step1Error = '请粘贴对话内容'; return; }
          this.fetching = true;
          this.step1Error = '';
          try {
            var d = await Api.api.importExtract(text);
            this.extracted = d;
            var tz = (Store.state.server && Store.state.server.timezone) || 'Asia/Shanghai';
            this.name = '导入人设-' + TimeUtils.todayStr(tz, Store.serverNowMs());
            this.content = d.suggestion || '';
            this.step3Error = '';
            this.step = 3;
          } catch (e) {
            this.step1Error = (e && e.message) || '提取失败';
          } finally {
            this.fetching = false;
          }
          return;
        }
        var u = this.url.trim();
        if (!u) { this.step1Error = '请输入下载地址'; return; }
        if (!/^https?:\/\//i.test(u)) { this.step1Error = '仅支持 http/https 地址'; return; }
        this.fetching = true;
        this.step1Error = '';
        try {
          var fd = await Api.api.importFetch(u);
          this.fetched = fd;
          this.step2Error = '';
          this.step = 2;
        } catch (e) {
          this.step1Error = (e && e.message) || '抓取失败';
        } finally {
          this.fetching = false;
        }
      },
      extract: async function () {
        if (!this.fetched) return;
        this.extracting = true;
        this.step2Error = '';
        try {
          var d = await Api.api.importExtract(
            this.fetched.transcript,
            this.fetched.title || undefined
          );
          this.extracted = d;
          var tz = (Store.state.server && Store.state.server.timezone) || 'Asia/Shanghai';
          this.name = '导入人设-' + TimeUtils.todayStr(tz, Store.serverNowMs());
          this.content = d.suggestion || '';
          this.step3Error = '';
          this.step = 3;
        } catch (e) {
          this.step2Error = (e && e.message) || '提取失败';
        } finally {
          this.extracting = false;
        }
      },
      save: async function () {
        var name = this.name.trim();
        if (!name || !this.content.trim()) {
          this.step3Error = '请填写名称与内容';
          return;
        }
        if (name.length > 50) {
          this.step3Error = '名称最多 50 字符';
          return;
        }
        if (this.content.length > 200000) {
          this.step3Error = '内容过长（最多 200000 字符）';
          return;
        }
        this.saving = true;
        this.step3Error = '';
        try {
          await Api.api.createPersona({ name: name, content: this.content });
          Store.toast('人设已保存', 'ok');
          Router.navigate('/personas');
        } catch (e) {
          this.step3Error = (e && e.message) || '保存失败';
        } finally {
          this.saving = false;
        }
      },
      restart: function () {
        this.step = 1;
        this.fetched = null;
        this.extracted = null;
        this.step1Error = '';
        this.step2Error = '';
        this.step3Error = '';
        this.name = '';
        this.content = '';
        this.pasted = '';
      },
    },
  };
})();
