/* 设置（#/settings）：
 * - API Key（password 型 + 显隐开关，占位“留空表示不修改”；已配置显示掩码，可清除）
 * - 模型下拉（GET /api/models）
 * - 测试 Key（POST /api/settings/test-key，显示 ok/message）
 * - 修改密码（旧 + 新；本机版隐藏）
 * - 数据备份/恢复（契约 34：仅本机版，Api.exportAllData / importAllData）
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.SettingsView = {
    template: '#tpl-settings',
    data: function () {
      return {
        localMode: !!window.__LOCAL_MODE__,
        hasApiKey: false,
        apiKeyMasked: '',
        model: '',
        models: [],
        apiKeyInput: '',
        showKey: false,
        savingKey: false,
        keyMsg: '',
        testing: false,
        testResult: null,
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
        pwMsg: '',
        pwOk: '',
        pwBusy: false,
        restoreError: '',
      };
    },
    async mounted() {
      try {
        var results = await Promise.all([Api.api.settings(), Api.api.models()]);
        var s = results[0];
        var m = results[1];
        this.hasApiKey = !!s.hasApiKey;
        this.apiKeyMasked = s.apiKeyMasked || '';
        this.model = s.model || '';
        this.models = (m && m.models) || [];
        this.syncDocPref(s);
      } catch (e) { /* toast 已弹出 */ }
    },
    methods: {
      /* 契约 18：docSuggestionEnabled 同步到全局（上传对话框勾选维护，设置页不新增 UI） */
      syncDocPref: function (s) {
        if (s && typeof s.docSuggestionEnabled === 'boolean') {
          Store.state.docSuggestionEnabled = s.docSuggestionEnabled;
        }
      },
      saveKey: async function () {
        var key = this.apiKeyInput.trim();
        if (!key) { this.keyMsg = '请输入要保存的 API Key'; return; }
        this.savingKey = true;
        this.keyMsg = '';
        try {
          var s = await Api.api.updateSettings({ apiKey: key });
          this.hasApiKey = !!s.hasApiKey;
          this.apiKeyMasked = s.apiKeyMasked || '';
          this.model = s.model || this.model;
          this.syncDocPref(s);
          this.apiKeyInput = '';
          Store.toast('API Key 已保存', 'ok');
        } catch (e) {
          this.keyMsg = (e && e.message) || '保存失败';
        } finally {
          this.savingKey = false;
        }
      },
      clearKey: async function () {
        if (!window.confirm('确定清除已保存的 API Key？')) return;
        this.keyMsg = '';
        try {
          var s = await Api.api.updateSettings({ apiKey: null });
          this.hasApiKey = !!s.hasApiKey;
          this.apiKeyMasked = s.apiKeyMasked || '';
          this.model = s.model || this.model;
          this.syncDocPref(s);
          Store.toast('已清除 API Key', 'ok');
        } catch (e) {
          this.keyMsg = (e && e.message) || '清除失败';
        }
      },
      onModelChange: async function () {
        try {
          var s = await Api.api.updateSettings({ model: this.model });
          this.hasApiKey = !!s.hasApiKey;
          this.apiKeyMasked = s.apiKeyMasked || '';
          this.syncDocPref(s);
          Store.toast('模型已更新', 'ok');
        } catch (e) {
          Store.toast((e && e.message) || '更新失败', 'error');
        }
      },
      testKey: async function () {
        this.testing = true;
        this.testResult = null;
        try {
          var key = this.apiKeyInput.trim();
          var r = await Api.api.testKey(key || undefined);
          this.testResult = { ok: !!r.ok, message: r.message || (r.ok ? 'Key 有效' : 'Key 无效') };
        } catch (e) {
          this.testResult = { ok: false, message: (e && e.message) || '测试失败' };
        } finally {
          this.testing = false;
        }
      },
      /* ----- 数据备份/恢复（契约 34，仅本机版）----- */
      backupData: async function () {
        try {
          await Api.exportAllData();
          Store.toast('备份已导出', 'ok');
        } catch (e) {
          Store.toast((e && e.message) || '导出失败', 'error');
        }
      },
      pickRestore: function () {
        if (this.$refs.restoreInput) this.$refs.restoreInput.click();
      },
      onRestorePick: function (evt) {
        var input = evt.target;
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        var self = this;
        var reader = new FileReader();
        reader.onerror = function () { self.restoreError = '文件读取失败，请重试'; };
        reader.onload = async function () {
          self.restoreError = '';
          var text = String(reader.result || '');
          var json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {
            self.restoreError = '备份文件格式不正确（需为 JSON）';
            return;
          }
          try {
            await Api.importAllData(json);
            Store.toast('已从备份恢复，即将刷新…', 'ok');
            setTimeout(function () { location.reload(); }, 800);
          } catch (e) {
            self.restoreError = (e && e.message) || '恢复失败';
          }
        };
        reader.readAsText(file, 'utf-8');
      },
      changePassword: async function () {
        this.pwMsg = '';
        this.pwOk = '';
        if (!this.oldPassword) { this.pwMsg = '请输入旧密码'; return; }
        if ((this.newPassword || '').length < 6) { this.pwMsg = '新密码至少 6 位'; return; }
        if (this.newPassword !== this.confirmPassword) { this.pwMsg = '两次输入的新密码不一致'; return; }
        this.pwBusy = true;
        try {
          await Api.api.changePassword(this.oldPassword, this.newPassword);
          this.pwOk = '密码修改成功';
          this.oldPassword = '';
          this.newPassword = '';
          this.confirmPassword = '';
        } catch (e) {
          this.pwMsg = (e && e.message) || '修改失败';
        } finally {
          this.pwBusy = false;
        }
      },
    },
  };
})();
