/* 聊天主界面（#/、#/chat/:id）：
 * - 桌面左侧会话列表 / 移动端抽屉；
 * - 新建聊天（选人设，无人设引导去 #/personas）；
 * - 流式消息（AbortController 可停止），SSE 事件 meta/delta/done/error；
 * - 助手消息 marked + DOMPurify 渲染（v-sanitize），代码块复制按钮；
 * - NO_API_KEY 错误 toast 提示去设置配 Key；错误可重试；
 * - done 后刷新会话列表并拉取权威消息。
 */
(function () {
  'use strict';
  window.Views = window.Views || {};

  /* ---------- 会话列表 ---------- */
  window.Views.ChatList = {
    template: '#tpl-chat-list',
    props: {
      chats: { type: Array, default: function () { return []; } },
      activeId: { type: String, default: null },
    },
    emits: ['select', 'new', 'remove'],
  };

  /* ---------- 新建聊天弹层 ---------- */
  window.Views.NewChatModal = {
    template: '#tpl-new-chat-modal',
    props: {
      personas: { type: Array, default: function () { return []; } },
      loading: { type: Boolean, default: false },
      /* 契约 19：GET /api/settings 的 defaultSelfPersona，用于预填「我的身份」 */
      defaultSelfPersona: { type: String, default: '' },
    },
    emits: ['close', 'create', 'goto-personas'],
    data: function () {
      return {
        selfText: this.defaultSelfPersona || '',
        saveSelfAsDefault: false,
        /* 契约 21：新建聊天可选模式，默认聊天模式 */
        mode: 'chat',
      };
    },
  };

  /* ---------- 聊天主视图 ---------- */
  window.Views.ChatView = {
    template: '#tpl-chat',
    data: function () {
      return {
        chats: [],
        selectedId: null,
        chat: null,
        loadingChats: false,
        loadingChat: false,
        drawerOpen: false,
        modalOpen: false,
        personas: [],
        personasLoading: false,
        input: '',
        streaming: false,
        abortCtrl: null,
        exportOpen: false,
        summarizing: false,
        stateOpen: true,       // 角色状态面板折叠态
        uploading: false,      // 文档上传中
        suggestDialog: null,   // 人设建议对话框 {docId,snippet,message,noMoreAsk,applying,error}
        defaultSelfPersona: '',      // 契约 19：默认自我人设（新建聊天预填）
        selfDialogOpen: false,       // 「我的身份」弹窗
        selfForm: { text: '', saveAsDefault: false },
        selfSaving: false,
        selfError: '',
        moreOpen: false,             // 移动端「更多」菜单
        dialogSettingsOpen: false,   // 「对话设置」弹窗（契约 21/29/31/32）
        dlgForm: {
          mode: 'chat',
          minReplyChars: 20,
          maxReplyChars: 500,
          storyMinChars: 300,          // 契约 29：故事长短（仅故事模式）
          storyMaxChars: 800,
          envDescriptionEnabled: true, // 环境描写开关
          envDescriptionChars: 150,
          novelMinChars: 1200,         // 契约 31：小说长短（仅小说模式）
          novelMaxChars: 3000,
          reasoningLevel: 'medium',    // 契约 32：推理强度 off/low/medium/high
        },
        dlgSaving: false,
        dlgError: '',
        lastUserContent: '',
      };
    },
    computed: {
      chatTitle: function () {
        if (!this.chat) return '聊天';
        return this.chat.title || this.chat.personaName || '聊天';
      },
      canSend: function () {
        return !!(this.chat && this.input.trim() && !this.streaming);
      },
      hasState: function () {
        return !!(this.chat && this.chat.stateEnabled &&
          this.chat.state && typeof this.chat.state === 'object' &&
          Object.keys(this.chat.state).length > 0);
      },
      routeParam: function () {
        return Router.state.param;
      },
    },
    watch: {
      routeParam: function (v) {
        if (v && v !== this.selectedId) this.selectChat(v);
      },
    },
    async mounted() {
      await this.loadChats();
      this.syncSettings();
      if (Router.state.param) await this.selectChat(Router.state.param);
    },
    beforeUnmount() {
      if (this.abortCtrl) {
        try { this.abortCtrl.abort(); } catch (e) { /* ignore */ }
      }
    },
    methods: {
      /* ----- 列表与聊天加载 ----- */
      /** chat 字段兜底：老聊天缺 state/stateEnabled/documents/selfPersona/mode/回话长短/personaAvatar/故事/小说/推理强度（契约 17/18/19/21/26/29/31/32） */
      normalizeChat: function (c) {
        if (!c) return c;
        c.messages = c.messages || [];
        c.documents = c.documents || [];
        c.state = (c.state && typeof c.state === 'object') ? c.state : {};
        c.stateEnabled = !!c.stateEnabled;
        c.selfPersona = (typeof c.selfPersona === 'string') ? c.selfPersona : '';
        c.personaAvatar = (typeof c.personaAvatar === 'string') ? c.personaAvatar : '';
        c.mode = (c.mode === 'story' || c.mode === 'novel') ? c.mode : 'chat';
        c.minReplyChars = (Number.isInteger(c.minReplyChars) && c.minReplyChars >= 1 && c.minReplyChars <= 2000)
          ? c.minReplyChars : 20;   // defaultReplyMin
        c.maxReplyChars = (Number.isInteger(c.maxReplyChars) && c.maxReplyChars >= 1 && c.maxReplyChars <= 4000)
          ? c.maxReplyChars : 500;  // defaultReplyMax
        // 契约 29：故事长短与环境描写（缺省 300/800/true/150）
        c.storyMinChars = (Number.isInteger(c.storyMinChars) && c.storyMinChars >= 1 && c.storyMinChars <= 2000)
          ? c.storyMinChars : 300;   // defaultStoryMin
        c.storyMaxChars = (Number.isInteger(c.storyMaxChars) && c.storyMaxChars >= 1 && c.storyMaxChars <= 4000)
          ? c.storyMaxChars : 800;   // defaultStoryMax
        c.envDescriptionEnabled = (typeof c.envDescriptionEnabled === 'boolean')
          ? c.envDescriptionEnabled : true;
        c.envDescriptionChars = (Number.isInteger(c.envDescriptionChars) && c.envDescriptionChars >= 0 && c.envDescriptionChars <= 2000)
          ? c.envDescriptionChars : 150;  // defaultEnvDescriptionChars
        // 契约 31：小说长短（缺省 1200/3000）
        c.novelMinChars = (Number.isInteger(c.novelMinChars) && c.novelMinChars >= 1 && c.novelMinChars <= 2000)
          ? c.novelMinChars : 1200;  // defaultNovelMin
        c.novelMaxChars = (Number.isInteger(c.novelMaxChars) && c.novelMaxChars >= 1 && c.novelMaxChars <= 4000)
          ? c.novelMaxChars : 3000;  // defaultNovelMax
        // 契约 32：推理强度（缺省 medium）
        c.reasoningLevel = (['off', 'low', 'medium', 'high'].indexOf(c.reasoningLevel) >= 0)
          ? c.reasoningLevel : 'medium';
        return c;
      },
      /** GET /api/settings 同步 docSuggestionEnabled（契约 18）与 defaultSelfPersona（契约 19） */
      syncSettings: async function () {
        try {
          var s = await Api.api.settings();
          if (!s) return;
          if (typeof s.docSuggestionEnabled === 'boolean') {
            Store.state.docSuggestionEnabled = s.docSuggestionEnabled;
          }
          if (typeof s.defaultSelfPersona === 'string') {
            this.defaultSelfPersona = s.defaultSelfPersona;
          }
        } catch (e) { /* 静默忽略，保持默认值 */ }
      },
      loadChats: async function () {
        this.loadingChats = true;
        try {
          var d = await Api.api.chats();
          this.chats = (d && d.chats) || [];
        } catch (e) { /* toast 已由封装弹出 */ }
        finally { this.loadingChats = false; }
      },
      selectChat: async function (id) {
        if (!id) return;
        if (this.abortCtrl) this.stopStreaming();
        this.selectedId = id;
        this.loadingChat = true;
        this.exportOpen = false;
        try {
          var d = await Api.api.chat(id);
          var c = d && d.chat;
          if (!c) throw new Error('聊天不存在');
          this.chat = this.normalizeChat(c);
          await this.$nextTick();
          this.scrollToBottom(true);
        } catch (e) {
          // 404 或网络失败：显示空状态（toast 已由封装弹出）
          this.chat = null;
        } finally {
          this.loadingChat = false;
        }
      },
      onSelect: function (id) {
        this.drawerOpen = false;
        if (this.selectedId !== id) Router.navigate('/chat/' + id);
      },
      onDrawerSelect: function (id) {
        this.drawerOpen = false;
        if (this.selectedId !== id) Router.navigate('/chat/' + id);
      },

      /* ----- 新建聊天 ----- */
      openNewChat: async function () {
        this.exportOpen = false;
        // 先取默认自我人设供弹窗预填（失败静默忽略）
        await this.syncSettings();
        this.modalOpen = true;
        if (!this.personas.length && !this.personasLoading) {
          this.personasLoading = true;
          try {
            var d = await Api.api.personas();
            this.personas = (d && d.personas) || [];
          } catch (e) { /* ignore */ }
          finally { this.personasLoading = false; }
        }
      },
      /* 契约 19/21：创建聊天可带 selfPersona / saveSelfPersonaAsDefault / mode */
      createChat: async function (persona, selfText, saveSelfAsDefault, mode) {
        this.modalOpen = false;
        try {
          var body = { personaId: persona.id };
          var sp = (selfText || '').trim();
          if (sp) body.selfPersona = sp;
          if (saveSelfAsDefault && sp) body.saveSelfPersonaAsDefault = true;
          body.mode = (mode === 'story' || mode === 'novel') ? mode : 'chat';
          var d = await Api.api.createChat(body);
          var c = d && d.chat;
          if (!c) throw new Error('创建失败');
          this.normalizeChat(c);
          if (saveSelfAsDefault && sp) this.defaultSelfPersona = sp; // 缓存默认值
          this.chats = [c].concat(this.chats.filter(function (x) { return x.id !== c.id; }));
          this.chat = c;
          this.selectedId = c.id;
          this.drawerOpen = false;
          Router.navigate('/chat/' + c.id);
          await this.$nextTick();
          this.scrollToBottom(true);
        } catch (e) { /* toast 已弹出 */ }
      },
      gotoPersonas: function () {
        this.modalOpen = false;
        Router.navigate('/personas');
      },

      /* ----- 我的身份（契约 19）----- */
      openSelfDialog: function () {
        if (!this.chat) return;
        this.moreOpen = false;
        this.selfForm = { text: this.chat.selfPersona || '', saveAsDefault: false };
        this.selfError = '';
        this.selfDialogOpen = true;
      },
      closeSelfDialog: function () {
        this.selfDialogOpen = false;
      },
      saveSelfPersona: async function () {
        if (!this.chat || this.selfSaving) return;
        var text = (this.selfForm.text || '').trim();
        if (text.length > 20000) {
          this.selfError = '我的身份最多 20000 字符';
          return;
        }
        this.selfSaving = true;
        this.selfError = '';
        try {
          await Api.api.updateChat(this.chat.id, {
            selfPersona: text,
            saveAsDefault: !!this.selfForm.saveAsDefault,
          });
          Store.toast(text ? '我的身份已保存' : '已清除我的身份', 'ok');
          if (this.selfForm.saveAsDefault) this.defaultSelfPersona = text; // 缓存默认值
          this.selfDialogOpen = false;
          // 刷新聊天以拿到权威 selfPersona
          await this.refreshChat({ silent: true });
        } catch (e) {
          this.selfError = (e && e.message) || '保存失败';
        } finally {
          this.selfSaving = false;
        }
      },

      /* ----- 对话设置（契约 21/29/31/32：模式 + 回话长短 + 故事长短 + 环境描写 + 小说长短 + 推理强度）----- */
      openDialogSettings: function () {
        if (!this.chat) return;
        this.moreOpen = false;
        this.dlgForm = {
          mode: (this.chat.mode === 'story' || this.chat.mode === 'novel') ? this.chat.mode : 'chat',
          minReplyChars: this.chat.minReplyChars,
          maxReplyChars: this.chat.maxReplyChars,
          storyMinChars: this.chat.storyMinChars,
          storyMaxChars: this.chat.storyMaxChars,
          envDescriptionEnabled: !!this.chat.envDescriptionEnabled,
          envDescriptionChars: this.chat.envDescriptionChars,
          novelMinChars: this.chat.novelMinChars,
          novelMaxChars: this.chat.novelMaxChars,
          reasoningLevel: this.chat.reasoningLevel,
        };
        this.dlgError = '';
        this.dialogSettingsOpen = true;
      },
      closeDialogSettings: function () {
        this.dialogSettingsOpen = false;
      },
      /* 契约 21/29/31/32 校验：整数、范围、min<=max；推理强度枚举 */
      validateDialogSettings: function () {
        var min = Number(this.dlgForm.minReplyChars);
        var max = Number(this.dlgForm.maxReplyChars);
        if (!Number.isInteger(min) || min < 1 || min > 2000) {
          return '最短回话字数需为 1..2000 的整数';
        }
        if (!Number.isInteger(max) || max < 1 || max > 4000) {
          return '最长回话字数需为 1..4000 的整数';
        }
        if (min > max) {
          return '最短回话字数不能大于最长回话字数';
        }
        if (['off', 'low', 'medium', 'high'].indexOf(this.dlgForm.reasoningLevel) < 0) {
          return '推理强度取值不合法';
        }
        if (this.dlgForm.mode === 'story') {
          var smin = Number(this.dlgForm.storyMinChars);
          var smax = Number(this.dlgForm.storyMaxChars);
          if (!Number.isInteger(smin) || smin < 1 || smin > 2000) {
            return '最短故事字数需为 1..2000 的整数';
          }
          if (!Number.isInteger(smax) || smax < 1 || smax > 4000) {
            return '最长故事字数需为 1..4000 的整数';
          }
          if (smin > smax) {
            return '最短故事字数不能大于最长故事字数';
          }
          var env = Number(this.dlgForm.envDescriptionChars);
          if (!Number.isInteger(env) || env < 0 || env > 2000) {
            return '环境描写字数需为 0..2000 的整数';
          }
        }
        if (this.dlgForm.mode === 'novel') {
          var nmin = Number(this.dlgForm.novelMinChars);
          var nmax = Number(this.dlgForm.novelMaxChars);
          if (!Number.isInteger(nmin) || nmin < 1 || nmin > 2000) {
            return '最短小说字数需为 1..2000 的整数';
          }
          if (!Number.isInteger(nmax) || nmax < 1 || nmax > 4000) {
            return '最长小说字数需为 1..4000 的整数';
          }
          if (nmin > nmax) {
            return '最短小说字数不能大于最长小说字数';
          }
        }
        return '';
      },
      saveDialogSettings: async function () {
        if (!this.chat || this.dlgSaving) return;
        var err = this.validateDialogSettings();
        if (err) {
          this.dlgError = err;
          return;
        }
        this.dlgSaving = true;
        this.dlgError = '';
        try {
          await Api.api.updateChat(this.chat.id, {
            mode: this.dlgForm.mode,
            minReplyChars: Number(this.dlgForm.minReplyChars),
            maxReplyChars: Number(this.dlgForm.maxReplyChars),
            storyMinChars: Number(this.dlgForm.storyMinChars),
            storyMaxChars: Number(this.dlgForm.storyMaxChars),
            envDescriptionEnabled: !!this.dlgForm.envDescriptionEnabled,
            envDescriptionChars: Number(this.dlgForm.envDescriptionChars),
            novelMinChars: Number(this.dlgForm.novelMinChars),
            novelMaxChars: Number(this.dlgForm.novelMaxChars),
            reasoningLevel: this.dlgForm.reasoningLevel,
          });
          Store.toast('对话设置已保存', 'ok');
          this.dialogSettingsOpen = false;
          // 刷新聊天以拿到权威设置
          await this.refreshChat({ silent: true });
        } catch (e) {
          this.dlgError = (e && e.message) || '保存失败';
        } finally {
          this.dlgSaving = false;
        }
      },

      /* ----- 发送与流式接收 ----- */
      onSend: function () {
        if (!this.canSend) return;
        var text = this.input.trim();
        this.send(text);
      },
      send: function (text) {
        text = (text || '').trim();
        if (!this.chat || !text || this.streaming) return;
        if (text.length > 50000) {
          Store.toast('消息过长（最多 50000 字符）', 'error');
          return;
        }
        this.lastUserContent = text;
        var nowIso = new Date().toISOString();
        var userMsg = {
          id: 'local-u-' + Date.now(),
          role: 'user',
          content: text,
          ts: nowIso,
          local: true,
        };
        var asstMsg = {
          id: 'local-a-' + Date.now(),
          role: 'assistant',
          content: '',
          ts: nowIso,
          streaming: true,
          streamError: '',
          stopped: false,
        };
        this.chat.messages.push(userMsg, asstMsg);
        this.input = '';
        var self = this;
        this.$nextTick(function () { self.scrollToBottom(true); });
        this.startStream(text, asstMsg);
      },
      /** 重试失败的回答：以同一占位气泡重新发起流式（服务器会再次保存用户消息） */
      retry: function (m) {
        if (this.streaming || !this.chat) return;
        var text = this.userContentBefore(m);
        if (!text) return;
        m.streamError = '';
        m.stopped = false;
        m.streaming = true;
        m.content = '';
        this.startStream(text, m);
      },
      userContentBefore: function (m) {
        var msgs = this.chat.messages || [];
        var i = msgs.indexOf(m);
        for (var k = i - 1; k >= 0; k--) {
          if (msgs[k].role === 'user') return msgs[k].content;
        }
        return this.lastUserContent;
      },
      startStream: function (text, asstMsg) {
        var self = this;
        var chatId = this.chat.id;
        var ctrl = new AbortController();
        this.abortCtrl = ctrl;
        this.streaming = true;
        var finished = false;

        function finish() {
          self.streaming = false;
          self.abortCtrl = null;
        }

        return Api.streamChat(chatId, text, {
          onMeta: function (evt) {
            if (evt.messageId) asstMsg.id = evt.messageId;
            if (evt.model) asstMsg.model = evt.model;
          },
          onDelta: function (evt) {
            asstMsg.content += (evt.content || '');
            self.$nextTick(function () { self.scrollIfNearBottom(); });
          },
          onDone: function (evt) {
            finished = true;
            var m = evt.message || {
              id: asstMsg.id, role: 'assistant', content: asstMsg.content,
              ts: new Date().toISOString(),
            };
            var i = (self.chat.messages || []).indexOf(asstMsg);
            if (i >= 0) {
              self.chat.messages.splice(i, 1, Object.assign({}, m, { streaming: false }));
            }
            // 契约 17：done 事件携带最新 state（仅 stateEnabled 时），即时刷新角色状态面板
            if (evt.state && typeof evt.state === 'object') {
              self.chat.state = Object.assign({}, evt.state);
            }
            self.afterStreamDone(chatId);
          },
          onError: function (evt) {
            finished = true;
            asstMsg.streaming = false;
            asstMsg.streamError = evt.message || '生成失败';
            self.afterStreamError(chatId, evt);
          },
        }, ctrl.signal).then(function () {
          if (!finished) {
            asstMsg.streaming = false;
            asstMsg.streamError = '响应意外中断';
            self.refreshListOnly();
          }
        }).catch(function (e) {
          if (e && e.name === 'AbortError') {
            // 用户主动停止：保留已生成的部分
            asstMsg.streaming = false;
            asstMsg.stopped = true;
            self.refreshListOnly();
          } else {
            asstMsg.streaming = false;
            asstMsg.streamError = (e && e.message) || '发送失败';
            self.handleStreamException(e);
          }
        }).finally(finish);
      },
      afterStreamDone: function (chatId) {
        this.refreshListOnly();
        // 拉取服务端权威数据（覆盖乐观插入；含 state/documents 等，处理重试产生的重复消息）
        var self = this;
        Api.api.chat(chatId).then(function (d) {
          if (self.selectedId === chatId && self.chat && !self.streaming) {
            var c = self.normalizeChat(d && d.chat);
            if (c) self.chat = c;
            self.$nextTick(function () { self.scrollToBottom(true); });
          }
        }).catch(function () { /* ignore */ });
      },
      afterStreamError: function (chatId, evt) {
        var hint = evt.code === 'NO_API_KEY'
          ? '，请先到「设置」页配置 DeepSeek API Key'
          : '';
        Store.toast((evt.message || '生成失败') + hint, 'error');
        this.refreshListOnly();
      },
      handleStreamException: function (e) {
        if (e && e.code === 'NO_API_KEY') {
          Store.toast('未配置 API Key：请先到「设置」页配置 DeepSeek API Key。', 'error');
        } else if (!(e instanceof Api.ApiError)) {
          Store.toast('网络错误，请重试', 'error');
        } else {
          Store.toast(e.message, 'error');
        }
        this.refreshListOnly();
      },
      refreshListOnly: function () {
        this.loadChats();
      },
      stopStreaming: function () {
        if (this.abortCtrl) {
          try { this.abortCtrl.abort(); } catch (e) { /* ignore */ }
        }
      },

      /* ----- 删除 / 导出 ----- */
      deleteChat: async function (c) {
        if (!window.confirm('确定删除聊天「' + (c.title || c.personaName || '未命名') + '」？此操作不可恢复。')) return;
        try {
          await Api.api.deleteChat(c.id);
          this.chats = this.chats.filter(function (x) { return x.id !== c.id; });
          if (this.selectedId === c.id) {
            this.selectedId = null;
            this.chat = null;
            Router.navigate('/');
          }
          Store.toast('聊天已删除', 'ok');
        } catch (e) { /* toast 已弹出 */ }
      },
      exportChat: async function (format) {
        if (!this.chat) return;
        this.exportOpen = false;
        // 本机版：Blob 下载（local-api 提供 exportChat）
        if (window.__LOCAL_MODE__ && Api.exportChat) {
          try {
            await Api.exportChat(this.chat.id, format);
          } catch (e) {
            Store.toast((e && e.message) || '导出失败', 'error');
          }
          return;
        }
        window.location.href = '/api/chats/' + encodeURIComponent(this.chat.id) + '/export?format=' + format;
      },

      /* ----- 压缩历史（契约 16.1）----- */
      summarize: async function () {
        if (!this.chat || this.summarizing || this.streaming) return;
        this.moreOpen = false;
        if (!window.confirm('将把较早的对话压缩为一段摘要，仅保留最近 20 条消息；压缩后较早的原文不可恢复，确定继续？')) return;
        this.summarizing = true;
        try {
          var d = await Api.api.summarizeChat(this.chat.id);
          var removed = (d && d.removedCount) || 0;
          Store.toast('压缩完成：' + removed + ' 条较早消息已合并为摘要', 'ok');
          // 重新 GET 该聊天，以服务端最新 messages/summary 为准刷新
          await this.reloadChat();
        } catch (e) {
          if (e && e.code === 'NO_API_KEY') {
            Store.toast('未配置 API Key：请先到「设置」页配置 DeepSeek API Key。', 'error');
          } else if (e && e.message) {
            Store.toast(e.message, 'error');
          } else {
            Store.toast('压缩失败，请重试', 'error');
          }
        } finally {
          this.summarizing = false;
        }
      },
      /** 重新拉取当前聊天并刷新列表 */
      reloadChat: async function () {
        await this.refreshChat({ silent: false });
        this.loadChats();
      },
      /** 拉取当前聊天；silent=true 不强制滚动到底（上传文档后静默刷新用） */
      refreshChat: async function (opts) {
        var id = this.selectedId;
        if (!id) return;
        opts = opts || {};
        try {
          var d = await Api.api.chat(id);
          if (!d || !d.chat || d.chat.id !== this.selectedId) return;
          this.chat = this.normalizeChat(d.chat);
          if (!opts.silent) {
            await this.$nextTick();
            this.scrollToBottom(true);
          }
        } catch (e) { /* toast 已由封装弹出 */ }
      },

      /* ----- 角色状态面板（契约 17）----- */
      toggleState: function () {
        this.stateOpen = !this.stateOpen;
      },

      /* ----- 文档上传与人设建议（契约 18）----- */
      pickDoc: function () {
        if (this.$refs.docInput) this.$refs.docInput.click();
      },
      onPickDoc: function (evt) {
        var input = evt.target;
        var file = input.files && input.files[0];
        input.value = ''; // 允许重复选择同一文件
        if (!file) return;
        if (!this.chat || this.uploading || this.streaming) return;
        if (!/\.txt$/i.test(file.name)) {
          Store.toast('仅支持上传 .txt 文档', 'error');
          return;
        }
        var self = this;
        var reader = new FileReader();
        reader.onerror = function () {
          Store.toast('文件读取失败，请重试', 'error');
        };
        reader.onload = async function () {
          var content = String(reader.result || '');
          if (!content.trim()) {
            Store.toast('文档内容为空', 'error');
            return;
          }
          if (content.length > 500000) {
            Store.toast('文档过大（最多 50 万字符）', 'error');
            return;
          }
          self.uploading = true;
          try {
            var d = await Api.api.uploadDocument(self.chat.id, { filename: file.name, content: content });
            Store.toast('文档已上传', 'ok');
            // 刷新聊天以拿到 documents 列表
            await self.refreshChat({ silent: true });
            var docId = d && d.document && d.document.id;
            if (docId && Store.state.docSuggestionEnabled) {
              await self.analyzeAndSuggest(docId);
            }
          } catch (e) {
            if (e && e.code === 'NO_API_KEY') {
              Store.toast('未配置 API Key：请先到「设置」页配置 DeepSeek API Key。', 'error');
            } else {
              Store.toast((e && e.message) || '上传失败', 'error');
            }
          } finally {
            self.uploading = false;
          }
        };
        reader.readAsText(file, 'utf-8');
      },
      /** 分析文档；relevant=true 弹「加入人设」对话框 */
      analyzeAndSuggest: async function (docId) {
        try {
          var r = await Api.api.analyzeDocument(this.chat.id, docId);
          if (!r) return;
          if (r.relevant) {
            this.suggestDialog = {
              docId: docId,
              snippet: (r.snippet || '').trim(),
              message: r.message || '',
              noMoreAsk: false,
              applying: false,
              error: '',
            };
          } else if (r.message) {
            Store.toast(r.message, 'info');
          }
        } catch (e) {
          // 分析失败不阻断文档使用（文档已上传并会注入上下文）
          if (e && e.code === 'NO_API_KEY') {
            Store.toast('未配置 API Key，已跳过文档分析；请到「设置」页配置 Key。', 'error');
          } else if (e && e.message) {
            Store.toast(e.message, 'error');
          }
        }
      },
      /** [加入人设] → POST apply(snippet) → toast「已加入人设」 */
      applySuggestion: async function () {
        var dlg = this.suggestDialog;
        if (!dlg || dlg.applying) return;
        if (!dlg.snippet) {
          dlg.error = '没有可加入的片段';
          return;
        }
        dlg.applying = true;
        dlg.error = '';
        try {
          await Api.api.applyDocument(this.chat.id, dlg.docId, dlg.snippet);
          Store.toast('已加入人设', 'ok');
          if (dlg.noMoreAsk) await this.setDocSuggestion(false);
          this.suggestDialog = null;
        } catch (e) {
          dlg.error = (e && e.message) || '加入失败';
          dlg.applying = false;
        }
      },
      /** [忽略] → 关闭；若勾选「以后不再提醒」则关开关 */
      dismissSuggestion: async function () {
        var dlg = this.suggestDialog;
        this.suggestDialog = null;
        if (dlg && dlg.noMoreAsk) await this.setDocSuggestion(false);
      },
      /** PUT /api/settings {docSuggestionEnabled} */
      setDocSuggestion: async function (enabled) {
        try {
          var s = await Api.api.updateSettings({ docSuggestionEnabled: enabled });
          if (s && typeof s.docSuggestionEnabled === 'boolean') {
            Store.state.docSuggestionEnabled = s.docSuggestionEnabled;
          }
        } catch (e) { /* toast 已由封装弹出 */ }
      },

      /* ----- 滚动 ----- */
      scrollToBottom: function (force) {
        var el = this.$refs.msgBox;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      },
      scrollIfNearBottom: function () {
        var el = this.$refs.msgBox;
        if (!el) return;
        var near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        if (near) el.scrollTop = el.scrollHeight;
      },
    },
  };
})();
