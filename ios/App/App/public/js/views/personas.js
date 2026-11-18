/* 人设管理（#/personas）：列表（头像缩略图/名称/大小/更新时间）、新建/编辑（name+content+字数统计+人物属性+状态系统+头像上传+文件导入）、下载 txt、删除。
 * 契约 16.2：attributes；契约 17：stateAttributes/stateEnabled；
 * 契约 26：头像（avatarUrl、POST/DELETE /api/personas/:id/avatar）；
 * 契约 27：文件导入（POST /api/personas/import-file，{filename,dataBase64}）。 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  window.Views.PersonasView = {
    template: '#tpl-personas',
    data: function () {
      return {
        personas: [],
        loading: true,
        loadError: '',
        editing: false,
        editId: null,
        form: { name: '', content: '', attributes: [], stateAttributes: [], stateEnabled: false, avatarUrl: null },
        formError: '',
        saving: false,
        attrSeq: 0,
        avatarUploading: false,   // 头像上传/移除中
        avatarError: '',
        importing: false,         // 文件导入中
        importError: '',
      };
    },
    computed: {
      contentLen: function () { return (this.form.content || '').length; },
      canSave: function () {
        return this.form.name.trim().length > 0 &&
          this.contentLen > 0 && this.contentLen <= 200000;
      },
    },
    async mounted() {
      await this.load();
    },
    methods: {
      /* 服务端 [{key,value}] → 编辑行（带本地 _uid 供 v-for key） */
      rowsFrom: function (list) {
        var self = this;
        return (list || []).map(function (x) {
          self.attrSeq += 1;
          return { key: (x && x.key) || '', value: (x && x.value) || '', _uid: 'a' + self.attrSeq };
        });
      },
      load: async function () {
        this.loading = true;
        this.loadError = '';
        try {
          var d = await Api.api.personas();
          this.personas = (d && d.personas) || [];
        } catch (e) {
          this.loadError = (e && e.message) || '加载失败';
        } finally {
          this.loading = false;
        }
      },
      startCreate: function () {
        this.editing = true;
        this.editId = null;
        this.form = { name: '', content: '', attributes: [], stateAttributes: [], stateEnabled: false, avatarUrl: null };
        this.formError = '';
        this.avatarError = '';
        this.importError = '';
      },
      startEdit: async function (p) {
        this.editing = true;
        this.editId = p.id;
        this.formError = '';
        this.saving = false;
        this.avatarError = '';
        this.importError = '';
        try {
          var d = await Api.api.persona(p.id);
          // 契约 16.2/17/26：GET 返回 {persona:{id,name,content,attributes,stateAttributes,stateEnabled,avatarUrl,updatedAt}}，content 不含属性/状态段
          this.form = {
            name: d.persona.name,
            content: d.persona.content,
            attributes: this.rowsFrom(d.persona.attributes),
            stateAttributes: this.rowsFrom(d.persona.stateAttributes),
            stateEnabled: !!d.persona.stateEnabled,
            avatarUrl: d.persona.avatarUrl || null,
          };
        } catch (e) {
          this.editing = false;
        }
      },
      cancel: function () {
        this.editing = false;
        this.formError = '';
      },
      addAttribute: function () {
        if (this.form.attributes.length >= 50) return;
        this.attrSeq += 1;
        this.form.attributes.push({ key: '', value: '', _uid: 'a' + this.attrSeq });
      },
      removeAttribute: function (i) {
        this.form.attributes.splice(i, 1);
      },
      /* ----- 状态系统（契约 17）----- */
      addStateAttribute: function () {
        if (this.form.stateAttributes.length >= 50) return;
        this.attrSeq += 1;
        this.form.stateAttributes.push({ key: '', value: '', _uid: 's' + this.attrSeq });
      },
      removeStateAttribute: function (i) {
        this.form.stateAttributes.splice(i, 1);
      },
      /* 编辑行 → 提交用 [{key,value}]（空行忽略；key/value 去首尾空白） */
      buildKvList: function (rows) {
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          var key = (r.key || '').trim();
          var value = (r.value || '').trim();
          if (!key && !value) continue;
          out.push({ key: key, value: value });
        }
        return out;
      },
      buildAttributes: function () {
        return this.buildKvList(this.form.attributes);
      },
      buildStateAttributes: function () {
        return this.buildKvList(this.form.stateAttributes);
      },
      /* 契约 16.2/17 校验：最多 50 项；key 1..30；value 0..500 */
      validateKvList: function (list, label) {
        if (list.length > 50) return label + '最多 50 项';
        for (var i = 0; i < list.length; i++) {
          if (!list[i].key) return label + '名不能为空（可删除该空行）';
          if (list[i].key.length > 30) return label + '名最多 30 字符';
          if (list[i].value.length > 500) return label + '值最多 500 字符';
        }
        return '';
      },
      validateAttributes: function (list) {
        return this.validateKvList(list, '属性');
      },
      validateStateAttributes: function (list) {
        return this.validateKvList(list, '状态');
      },
      save: async function () {
        var name = this.form.name.trim();
        if (name.length < 1 || name.length > 50) {
          this.formError = '名称需为 1-50 个字符';
          return;
        }
        if (this.contentLen < 1) {
          this.formError = '人设内容不能为空';
          return;
        }
        if (this.contentLen > 200000) {
          this.formError = '内容过长（最多 200000 字符）';
          return;
        }
        var attributes = this.buildAttributes();
        var stateAttributes = this.buildStateAttributes();
        var err = this.validateAttributes(attributes) || this.validateStateAttributes(stateAttributes);
        if (err) {
          this.formError = err;
          return;
        }
        this.saving = true;
        this.formError = '';
        try {
          var body = {
            name: name,
            content: this.form.content,
            attributes: attributes,
            stateAttributes: stateAttributes,
            stateEnabled: !!this.form.stateEnabled,
          };
          if (this.editId) {
            await Api.api.updatePersona(this.editId, body);
          } else {
            await Api.api.createPersona(body);
          }
          Store.toast('人设已保存', 'ok');
          this.editing = false;
          await this.load();
        } catch (e) {
          this.formError = (e && e.message) || '保存失败';
        } finally {
          this.saving = false;
        }
      },
      remove: async function (p) {
        if (!window.confirm('确定删除人设「' + p.name + '」？此操作不可恢复（引用它的聊天不受影响）。')) return;
        try {
          await Api.api.deletePersona(p.id);
          Store.toast('已删除', 'ok');
          if (this.editId === p.id) {
            this.editing = false;
            this.editId = null;
          }
          await this.load();
        } catch (e) { /* toast 已弹出 */ }
      },
      download: async function (p) {
        // 本机版：Blob 下载（local-api 提供 exportPersona）
        if (window.__LOCAL_MODE__ && Api.exportPersona) {
          try {
            await Api.exportPersona(p.id);
          } catch (e) {
            Store.toast((e && e.message) || '下载失败', 'error');
          }
          return;
        }
        window.location.href = '/api/personas/' + encodeURIComponent(p.id) + '/export';
      },

      /* ----- 角色头像（契约 26）----- */
      pickAvatar: function () {
        if (!this.editId) {
          Store.toast('请先保存人设后再上传头像', 'error');
          return;
        }
        if (this.$refs.avatarInput) this.$refs.avatarInput.click();
      },
      /** 头像前端预校验：仅 png/jpg、≤2MB */
      validateAvatarFile: function (file) {
        if (!file) return '未选择文件';
        if (file.type !== 'image/png' && file.type !== 'image/jpeg') return '仅支持 PNG / JPG 图片';
        if (file.size > 2097152) return '图片过大（最大 2MB）';
        return '';
      },
      /** 本机版：canvas 压缩头像（最长边 ≤512px、JPEG q0.85），控制 localStorage 占用；失败回退原图 */
      compressAvatar: function (dataUrl) {
        return new Promise(function (resolve) {
          try {
            var img = new Image();
            img.onload = function () {
              try {
                var w = img.naturalWidth || img.width;
                var h = img.naturalHeight || img.height;
                var maxSide = 512;
                var scale = Math.min(1, maxSide / Math.max(w, h));
                var cw = Math.max(1, Math.round(w * scale));
                var ch = Math.max(1, Math.round(h * scale));
                var canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, cw, ch);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
              } catch (e) {
                resolve(dataUrl);
              }
            };
            img.onerror = function () { resolve(dataUrl); };
            img.src = dataUrl;
          } catch (e) {
            resolve(dataUrl);
          }
        });
      },
      onAvatarPick: function (evt) {
        var input = evt.target;
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        var err = this.validateAvatarFile(file);
        if (err) { Store.toast(err, 'error'); return; }
        if (!this.editId) { Store.toast('请先保存人设后再上传头像', 'error'); return; }
        var self = this;
        var reader = new FileReader();
        reader.onerror = function () { Store.toast('文件读取失败，请重试', 'error'); };
        reader.onload = async function () {
          self.avatarUploading = true;
          self.avatarError = '';
          try {
            var payload = String(reader.result);
            if (window.__LOCAL_MODE__) payload = await self.compressAvatar(payload);
            var d = await Api.api.uploadPersonaAvatar(self.editId, payload);
            if (d && d.persona && d.persona.avatarUrl) self.form.avatarUrl = d.persona.avatarUrl;
            Store.toast('头像已上传', 'ok');
            await self.load();
          } catch (e) {
            self.avatarError = (e && e.message) || '上传失败';
            Store.toast(self.avatarError, 'error');
          } finally {
            self.avatarUploading = false;
          }
        };
        reader.readAsDataURL(file);
      },
      removeAvatar: async function () {
        if (!this.editId) {
          Store.toast('请先保存人设后再操作头像', 'error');
          return;
        }
        this.avatarUploading = true;
        this.avatarError = '';
        try {
          await Api.api.deletePersonaAvatar(this.editId);
          this.form.avatarUrl = null;
          Store.toast('头像已移除', 'ok');
          await this.load();
        } catch (e) {
          this.avatarError = (e && e.message) || '移除失败';
          Store.toast(this.avatarError, 'error');
        } finally {
          this.avatarUploading = false;
        }
      },

      /* ----- 人设文件导入（契约 27）----- */
      pickImport: function () {
        if (this.$refs.importInput) this.$refs.importInput.click();
      },
      /** 导入文件前端预校验：扩展名清单、≤2MB */
      validateImportFile: function (file) {
        if (!file) return '未选择文件';
        var name = (file.name || '').toLowerCase();
        if (!/\.(txt|md|markdown|json|html|htm|rtf|docx)$/.test(name)) {
          return '不支持的文件格式（支持 txt/md/json/html/rtf/docx）';
        }
        if (file.size > 2097152) return '文件过大（最大 2MB）';
        return '';
      },
      onImportPick: function (evt) {
        var input = evt.target;
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        var err = this.validateImportFile(file);
        if (err) { Store.toast(err, 'error'); return; }
        var self = this;
        var reader = new FileReader();
        reader.onerror = function () { Store.toast('文件读取失败，请重试', 'error'); };
        reader.onload = async function () {
          var dataUrl = String(reader.result || '');
          var base64 = dataUrl.indexOf(',') >= 0 ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
          self.importing = true;
          self.importError = '';
          try {
            var d = await Api.api.importPersonaFile(file.name, base64);
            await self.applyImported(d);
          } catch (e) {
            self.importError = (e && e.message) || '导入失败';
            Store.toast(self.importError, 'error');
          } finally {
            self.importing = false;
          }
        };
        reader.readAsDataURL(file);
      },
      /** 导入成功：已有内容先 confirm 覆盖，再填入正文；warnings 逐个 toast */
      applyImported: async function (data) {
        if (!data || typeof data.content !== 'string') {
          Store.toast('导入结果异常', 'error');
          return;
        }
        var existing = (this.form.content || '').trim();
        if (existing && !window.confirm('正文已有内容，确定用导入的内容覆盖？')) return;
        this.form.content = data.content;
        var warnings = data.warnings || [];
        warnings.forEach(function (w) { Store.toast(String(w), 'info'); });
        Store.toast('导入成功' + (data.format ? '（' + data.format + '）' : ''), 'ok');
      },
    },
  };
})();
