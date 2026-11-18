/* ============================================================================
 * 本机版（无服务器）Api 实现（契约 34）。
 * - 提供与服务器版 window.Api 完全相同的表面：Api.api.*、Api.streamChat、Api.ApiError；
 *   另暴露 Api.exportPersona / Api.exportChat / Api.exportAllData / Api.importAllData。
 * - 数据全部存 localStorage（window.LocalStore，键 pcl:*）；
 *   模型调用直连 https://api.deepseek.com（浏览器 CORS 已允许）。
 * - 提示词组装、字段归一化、隐藏状态更新、历史压缩、文档分析等逻辑与 server/ 实现一致。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------- 常量（与服务端 config.default.json 一致 + 本机限制） ---------------- */
  var CFG = {
    deepseekBaseUrl: 'https://api.deepseek.com',
    systemPromptSuffix: '以上是你必须严格遵守的人设设定。请始终以该人设的身份、语气、立场与知识背景进行回复，不要跳出角色，不要提及你是一个 AI 模型。',
    maxHistoryMessages: 60,
    summarizeKeepRecent: 20,
    summarizeMaxChars: 200000,
    summarizeModel: 'deepseek-chat',
    summarizeSystemPrompt: '请把下面的对话历史压缩成一段第三人称、简洁的中文摘要，只保留关键信息：角色关系、重要事件、人物或用户的偏好与习惯、待办事项、人设设定的变化等。不要编造不存在的内容，控制在 200-800 字。',
    stateUpdateModel: 'deepseek-chat',
    stateUpdateSystemPrompt: '你负责根据最新对话更新角色的状态值。请只输出一个 JSON 对象：键为给定的状态名，值为更新后的数值或短文本，不要输出任何解释或其他内容。',
    stateUpdateContextMessages: 6,
    maxDocumentsPerChat: 20,
    maxDocumentChars: 200000, // 契约 34：本机版单文档 ≤200KB
    maxDocumentContextChars: 80000,
    docAnalyzeModel: 'deepseek-chat',
    docAnalyzeSystemPrompt: '请判断下面的文档是否包含人设/角色设定相关内容。若包含，输出 JSON：{"relevant":true,"snippet":"建议加入人设的原文段落"}；若不包含，输出 {"relevant":false,"snippet":""}。只输出 JSON，不要其他内容。',
    maxSelfPersonaChars: 20000,
    maxAvatarBytes: 1048576, // 契约 34：本机版头像 ≤1MB
    maxPersonaImportBytes: 2097152,
    defaultReplyMin: 20,
    defaultReplyMax: 500,
    replyMaxLimit: 4000,
    modeChatPrompt: '当前为聊天模式：请以角色身份进行自然对话，只输出角色的对话内容，不要输出旁白、动作描写或场景描写。',
    modeStoryPrompt: '当前为故事模式：请以角色身份继续这个故事。除角色对话外，还要输出角色的神态、动作、心理与环境氛围等描写；同时承接用户输入中用户角色的动作与场景，使故事连贯推进。',
    replyLengthPrompt: '本次回复长度请控制在 {min} 到 {max} 个汉字之间。',
    defaultStoryMin: 300,
    defaultStoryMax: 800,
    defaultEnvDescriptionChars: 150,
    storyLengthPrompt: '本次故事回复长度请控制在 {min} 到 {max} 个汉字之间。',
    envDescriptionPrompt: '请在回复中加入对环境和人物周围的描写，描写部分约 {env} 个汉字。',
    envDescriptionOffPrompt: '本次不需要专门的环境描写。',
    translationPrompt: '如果回复中出现了中文以外的文字（如英文、日文、韩文等），请在该段文字之后用 {} 括起对应的简体中文翻译；纯中文回复无需翻译。',
    defaultNovelMin: 1200,
    defaultNovelMax: 3000,
    novelModePrompt: '当前为小说模式：请基于人设设定与已有背景，以小说体裁创作/续写内容。要求：篇幅尽量长、情节完整有推进（起承转合）、细节与环境描写丰富、保持与已有剧情连贯；正文可用章节或段落形式呈现。',
    novelLengthPrompt: '本次小说回复长度请不少于 {min} 个汉字，并尽量接近 {max} 个汉字。',
    defaultReasoningLevel: 'medium',
    reasoningOffPrompt: '请直接给出简洁回答，不要进行额外的推理、分析或论证过程。',
    reasoningLowPrompt: '请简要思考后直接作答，保持回答简洁。',
    reasoningHighPrompt: '请先在内心进行充分、深入的推理与逻辑校验（思考过程不要输出给用户），然后再给出最终回答。',
    extractSystemPrompt: '你是一个人设提取助手。用户会提供一段对话记录（【用户】为提问方，【助手】为与用户对话、被设定为人设的一方）。请从对话中提炼出【助手】一方（对方角色）的人设设定，输出一段人设描述文本（中文），涵盖该角色的身份、性格、说话风格、立场与背景等信息。必须严格基于对话内容，不得编造或补充对话中不存在的信息。直接输出人设描述文本本身，不要添加任何解释、标题或前缀。',
  };
  var MODELS = ['deepseek-chat', 'deepseek-reasoner'];
  var REASONING_LEVELS = ['off', 'low', 'medium', 'high'];
  var BOOT_TIME = new Date().toISOString();
  var LOCAL_USERNAME = '本机用户';

  /* ---------------- 基础工具 ---------------- */

  class ApiError extends Error {
    constructor(message, code, status, extra) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
      this.status = status || 0;
      this.extra = extra || {};
    }
  }

  function toast(message, type, opts) {
    if (opts && opts.toast === false) return;
    if (typeof Store !== 'undefined' && Store && typeof Store.toast === 'function') {
      Store.toast(message, type);
    }
  }

  function fail(message, code, status, extra, opts) {
    toast(message, 'error', opts);
    throw new ApiError(message, code, status, extra);
  }

  function nowIso() { return new Date().toISOString(); }
  function genId() { return window.LocalStore.genId(); }

  function byteLen(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s)).length;
    return unescape(encodeURIComponent(String(s))).length;
  }

  function maskApiKey(key) {
    if (!key || typeof key !== 'string') return null;
    if (key.length <= 7) return '***';
    return key.slice(0, 3) + '***' + key.slice(-4);
  }

  function serverInfo() {
    return { time: nowIso(), timezone: 'Asia/Shanghai' };
  }

  /* ---------------- 人设文本（移植 server/store.js） ---------------- */

  var PERSONA_ATTR_MARKER = '【人物属性】';
  var STATE_ATTR_MARKER = '【状态属性】';

  function parseAttrLines(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var m = /^-\s*([^：:]+?)\s*[：:]\s*(.*)$/.exec(lines[i]);
      if (m) out.push({ key: m[1].trim(), value: m[2].trim() });
    }
    return out;
  }

  function buildPersonaText(content, attributes, stateAttributes) {
    var body = String(content == null ? '' : content).replace(/[ \t\r\n]+$/u, '');
    var attrs = Array.isArray(attributes) ? attributes : [];
    var stateAttrs = Array.isArray(stateAttributes) ? stateAttributes : [];
    var lines = [body];
    if (attrs.length) {
      lines.push('', PERSONA_ATTR_MARKER);
      attrs.forEach(function (a) { lines.push('- ' + a.key + '：' + a.value); });
    }
    if (stateAttrs.length) {
      lines.push('', STATE_ATTR_MARKER);
      stateAttrs.forEach(function (a) { lines.push('- ' + a.key + '：' + a.value); });
    }
    return lines.join('\n');
  }

  function splitPersonaText(fullText) {
    var text = String(fullText == null ? '' : fullText);
    var lines = text.split(/\r?\n/);
    var idxAttr = lines.findIndex(function (l) { return l.trim() === PERSONA_ATTR_MARKER; });
    var idxState = lines.findIndex(function (l) { return l.trim() === STATE_ATTR_MARKER; });
    var markers = [idxAttr, idxState].filter(function (i) { return i !== -1; });
    var firstMarker = markers.length ? Math.min.apply(null, markers) : lines.length;
    var body = lines.slice(0, firstMarker).join('\n').replace(/[ \t\r\n]+$/u, '');
    var attributes = [];
    if (idxAttr !== -1) {
      attributes = parseAttrLines(lines.slice(idxAttr + 1, idxState > idxAttr ? idxState : lines.length));
    }
    var stateAttributes = [];
    if (idxState !== -1) {
      stateAttributes = parseAttrLines(lines.slice(idxState + 1, idxAttr > idxState ? idxAttr : lines.length));
    }
    return { content: body, attributes: attributes, stateAttributes: stateAttributes };
  }

  function cleanKeyValueList(value, label) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail(label + '需为数组', 'VALIDATION', 400);
    if (value.length > 50) fail(label + '最多 50 项', 'VALIDATION', 400);
    var out = [];
    value.forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail(label + '项需为 {key,value} 对象', 'VALIDATION', 400);
      if (typeof item.key !== 'string' || typeof item.value !== 'string') fail(label + '名与值需为字符串', 'VALIDATION', 400);
      var key = item.key.replace(/\s+/g, ' ').trim();
      var val = item.value.replace(/\s+/g, ' ').trim();
      if (!key || key.length > 30) fail(label + '名需为 1-30 字符', 'VALIDATION', 400);
      if (val.length > 500) fail(label + '值最多 500 字符', 'VALIDATION', 400);
      out.push({ key: key, value: val });
    });
    return out;
  }

  /* ---------------- 本机数据访问 ---------------- */

  async function getSettings() {
    var s = await window.LocalStore.get('settings', {});
    if (!s || typeof s !== 'object') s = {};
    return {
      apiKey: typeof s.apiKey === 'string' ? s.apiKey : null,
      model: typeof s.model === 'string' ? s.model : null,
      docSuggestionEnabled: s.docSuggestionEnabled !== false,
      defaultSelfPersona: typeof s.defaultSelfPersona === 'string' ? s.defaultSelfPersona : null,
    };
  }

  async function saveSettings(s) {
    await window.LocalStore.set('settings', s);
  }

  async function getPersonas() {
    var arr = await window.LocalStore.get('personas', []);
    return Array.isArray(arr) ? arr : [];
  }

  async function savePersonas(arr) {
    await window.LocalStore.set('personas', arr);
  }

  async function getChats() {
    var arr = await window.LocalStore.get('chats', []);
    return Array.isArray(arr) ? arr : [];
  }

  async function saveChats(arr) {
    await window.LocalStore.set('chats', arr);
  }

  function findPersona(personas, id) {
    return personas.find(function (p) { return p && p.id === id; }) || null;
  }

  function findChat(chats, id) {
    return chats.find(function (c) { return c && c.id === id; }) || null;
  }

  /* ---------------- 归一化（移植 server/routes/chats.js） ---------------- */

  function normalizeChat(c) {
    var chat = c || {};
    var out = {};
    out.id = chat.id || '';
    out.title = chat.title || '未命名聊天';
    out.personaId = chat.personaId || null;
    out.personaName = chat.personaName || '';
    out.model = chat.model || 'deepseek-chat';
    out.mode = chat.mode === 'story' ? 'story' : chat.mode === 'novel' ? 'novel' : 'chat';
    out.minReplyChars = Number.isInteger(chat.minReplyChars) ? chat.minReplyChars : CFG.defaultReplyMin;
    out.maxReplyChars = Number.isInteger(chat.maxReplyChars) ? chat.maxReplyChars : CFG.defaultReplyMax;
    out.storyMinChars = Number.isInteger(chat.storyMinChars) ? chat.storyMinChars : CFG.defaultStoryMin;
    out.storyMaxChars = Number.isInteger(chat.storyMaxChars) ? chat.storyMaxChars : CFG.defaultStoryMax;
    out.envDescriptionEnabled = typeof chat.envDescriptionEnabled === 'boolean' ? chat.envDescriptionEnabled : true;
    out.envDescriptionChars = Number.isInteger(chat.envDescriptionChars) ? chat.envDescriptionChars : CFG.defaultEnvDescriptionChars;
    out.novelMinChars = Number.isInteger(chat.novelMinChars) ? chat.novelMinChars : CFG.defaultNovelMin;
    out.novelMaxChars = Number.isInteger(chat.novelMaxChars) ? chat.novelMaxChars : CFG.defaultNovelMax;
    out.reasoningLevel = REASONING_LEVELS.indexOf(chat.reasoningLevel) >= 0 ? chat.reasoningLevel : CFG.defaultReasoningLevel;
    out.selfPersona = typeof chat.selfPersona === 'string' ? chat.selfPersona : '';
    out.stateEnabled = !!chat.stateEnabled;
    out.state = chat.state && typeof chat.state === 'object' && !Array.isArray(chat.state) ? Object.assign({}, chat.state) : {};
    out.documents = Array.isArray(chat.documents) ? chat.documents : [];
    out.summary = chat.summary || null;
    out.summaryAt = chat.summaryAt || null;
    out.createdAt = chat.createdAt || BOOT_TIME;
    out.updatedAt = chat.updatedAt || BOOT_TIME;
    out.messages = Array.isArray(chat.messages) ? chat.messages : [];
    return out;
  }

  function normalizePersona(p) {
    var rec = p || {};
    var full = buildPersonaText(rec.content || '', rec.attributes, rec.stateAttributes);
    return {
      id: rec.id || '',
      name: rec.name || '',
      content: typeof rec.content === 'string' ? rec.content : '',
      attributes: Array.isArray(rec.attributes) ? rec.attributes : [],
      stateAttributes: Array.isArray(rec.stateAttributes) ? rec.stateAttributes : [],
      stateEnabled: !!rec.stateEnabled,
      avatarUrl: typeof rec.avatarUrl === 'string' ? rec.avatarUrl : null,
      size: byteLen(full),
      updatedAt: rec.updatedAt || BOOT_TIME,
    };
  }

  /** 校验 mode/长度/故事/小说/推理字段，返回规范化后的完整字段集（create/update 共用）。 */
  function resolveChatFields(partial, base) {
    var f = {
      mode: base.mode,
      minReplyChars: base.minReplyChars,
      maxReplyChars: base.maxReplyChars,
      storyMinChars: base.storyMinChars,
      storyMaxChars: base.storyMaxChars,
      envDescriptionEnabled: base.envDescriptionEnabled,
      envDescriptionChars: base.envDescriptionChars,
      novelMinChars: base.novelMinChars,
      novelMaxChars: base.novelMaxChars,
      reasoningLevel: base.reasoningLevel,
    };
    if (partial.mode !== undefined) {
      if (partial.mode !== 'chat' && partial.mode !== 'story' && partial.mode !== 'novel') {
        fail("mode 需为 'chat'、'story' 或 'novel'", 'VALIDATION', 400);
      }
      f.mode = partial.mode;
    }
    var intRange = function (v, name, min, max) {
      if (!Number.isInteger(v) || v < min || v > max) fail(name + ' 需为 ' + min + '-' + max + ' 之间的整数', 'VALIDATION', 400);
      return v;
    };
    if (partial.minReplyChars !== undefined) f.minReplyChars = intRange(partial.minReplyChars, 'minReplyChars', 1, 2000);
    if (partial.maxReplyChars !== undefined) f.maxReplyChars = intRange(partial.maxReplyChars, 'maxReplyChars', 1, CFG.replyMaxLimit);
    if (f.minReplyChars > f.maxReplyChars) fail('minReplyChars 不能大于 maxReplyChars', 'VALIDATION', 400);
    if (partial.storyMinChars !== undefined) f.storyMinChars = intRange(partial.storyMinChars, 'storyMinChars', 1, 2000);
    if (partial.storyMaxChars !== undefined) f.storyMaxChars = intRange(partial.storyMaxChars, 'storyMaxChars', 1, CFG.replyMaxLimit);
    if (f.storyMinChars > f.storyMaxChars) fail('storyMinChars 不能大于 storyMaxChars', 'VALIDATION', 400);
    if (partial.envDescriptionEnabled !== undefined) {
      if (typeof partial.envDescriptionEnabled !== 'boolean') fail('envDescriptionEnabled 需为布尔值', 'VALIDATION', 400);
      f.envDescriptionEnabled = partial.envDescriptionEnabled;
    }
    if (partial.envDescriptionChars !== undefined) f.envDescriptionChars = intRange(partial.envDescriptionChars, 'envDescriptionChars', 0, 2000);
    if (partial.novelMinChars !== undefined) f.novelMinChars = intRange(partial.novelMinChars, 'novelMinChars', 1, 2000);
    if (partial.novelMaxChars !== undefined) f.novelMaxChars = intRange(partial.novelMaxChars, 'novelMaxChars', 1, CFG.replyMaxLimit);
    if (f.novelMinChars > f.novelMaxChars) fail('novelMinChars 不能大于 novelMaxChars', 'VALIDATION', 400);
    if (partial.reasoningLevel !== undefined) {
      if (REASONING_LEVELS.indexOf(partial.reasoningLevel) < 0) {
        fail("reasoningLevel 需为 'off'、'low'、'medium' 或 'high'", 'VALIDATION', 400);
      }
      f.reasoningLevel = partial.reasoningLevel;
    }
    return f;
  }

  /* ---------------- DeepSeek 直连 ---------------- */

  function joinUrl(base, p) {
    return String(base).replace(/\/+$/, '') + p;
  }

  /** 非 2xx 响应 → ApiError（读取上游错误信息）。 */
  async function upstreamError(res) {
    var detail = '';
    try {
      var j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (e) { /* 忽略 */ }
    if (res.status === 401 || res.status === 403) {
      return new ApiError('API Key 无效或已过期，请在设置中更新', 'LLM_ERROR', res.status, {});
    }
    if (res.status === 429) {
      return new ApiError('DeepSeek 请求过于频繁或额度不足，请稍后重试', 'LLM_ERROR', res.status, {});
    }
    return new ApiError('DeepSeek 接口错误（HTTP ' + res.status + '）' + (detail ? '：' + detail : ''), 'LLM_ERROR', res.status, {});
  }

  /** 非流式补全：返回完整文本。失败抛 ApiError。 */
  async function completionText(opts) {
    var key = opts.apiKey;
    var res;
    try {
      res = await fetch(joinUrl(CFG.deepseekBaseUrl, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: false }),
        signal: opts.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError('无法连接 DeepSeek：' + (e && e.message ? e.message : '网络错误，请重试'), 'LLM_ERROR', 0, {});
    }
    if (!res.ok) throw await upstreamError(res);
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return typeof content === 'string' ? content : '';
  }

  /** 提取 JSON 对象（容忍 ```json 围栏）。 */
  function extractJsonObject(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    var m = /\{[\s\S]*\}/.exec(s);
    try {
      return m ? JSON.parse(m[0]) : JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  /** 校验 DeepSeek API Key（GET /models）。返回 {ok, message}。 */
  async function testDeepSeekKey(apiKey) {
    var res;
    try {
      res = await fetch(joinUrl(CFG.deepseekBaseUrl, '/models'), {
        headers: { Authorization: 'Bearer ' + apiKey },
      });
    } catch (e) {
      return { ok: false, message: '无法连接 DeepSeek：' + (e && e.message ? e.message : '网络错误，请重试') };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'API Key 无效或未授权' };
    if (!res.ok) return { ok: false, message: 'DeepSeek 接口返回 HTTP ' + res.status };
    return { ok: true, message: 'API Key 有效，可以正常调用 DeepSeek' };
  }

  /* ---------------- 提示词组装（与 server/routes/chats.js 一致） ---------------- */

  function buildRequirementPrompt(f) {
    if (f.mode === 'novel') {
      var novelLen = CFG.novelLengthPrompt.replaceAll('{min}', String(f.novelMinChars)).replaceAll('{max}', String(f.novelMaxChars));
      return '【当前对话要求】\n' + CFG.novelModePrompt + '\n' + novelLen;
    }
    if (f.mode === 'story') {
      var storyLen = CFG.storyLengthPrompt.replaceAll('{min}', String(f.storyMinChars)).replaceAll('{max}', String(f.storyMaxChars));
      var env = f.envDescriptionEnabled
        ? CFG.envDescriptionPrompt.replaceAll('{env}', String(f.envDescriptionChars))
        : CFG.envDescriptionOffPrompt;
      return '【当前对话要求】\n' + CFG.modeStoryPrompt + '\n' + storyLen + '\n' + env;
    }
    var replyLen = CFG.replyLengthPrompt.replaceAll('{min}', String(f.minReplyChars)).replaceAll('{max}', String(f.maxReplyChars));
    return '【当前对话要求】\n' + CFG.modeChatPrompt + '\n' + replyLen;
  }

  function buildDocumentContext(chat, maxChars) {
    var docs = Array.isArray(chat.documents) ? chat.documents.slice().reverse() : [];
    if (!docs.length) return null;
    var blocks = ['【用户上传的文档】'];
    var used = blocks[0].length;
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var header = '---《' + d.filename + '》---';
      var available = maxChars - used - 1 - header.length - 1;
      if (available <= 0) break;
      var content = d.content.length > available ? d.content.slice(0, available) : d.content;
      blocks.push(header + '\n' + content);
      used += 1 + header.length + 1 + content.length;
      if (content.length < d.content.length) break;
    }
    return blocks.join('\n');
  }

  async function buildChatMessages(chat, persona, apiKeyForHistory) {
    var personaFull = persona
      ? buildPersonaText(persona.content, persona.attributes, persona.stateAttributes)
      : '';
    var messages = [];
    messages.push({ role: 'system', content: (personaFull + '\n\n' + CFG.systemPromptSuffix).trim() || '(无)' });
    messages.push({ role: 'system', content: buildRequirementPrompt(chat) });
    var reasoningPrompt = null;
    if (chat.reasoningLevel === 'off') reasoningPrompt = CFG.reasoningOffPrompt.trim();
    else if (chat.reasoningLevel === 'low') reasoningPrompt = CFG.reasoningLowPrompt.trim();
    else if (chat.reasoningLevel === 'high') reasoningPrompt = CFG.reasoningHighPrompt.trim();
    if (reasoningPrompt) messages.push({ role: 'system', content: '【推理强度要求】\n' + reasoningPrompt });
    if (CFG.translationPrompt.trim()) messages.push({ role: 'system', content: '【翻译要求】\n' + CFG.translationPrompt.trim() });
    if (chat.selfPersona) {
      messages.push({
        role: 'system',
        content: '【用户（对话者）的身份设定】\n' + chat.selfPersona + '\n（请在对话中把用户当作该身份，并据此称呼与互动）',
      });
    }
    if (chat.stateEnabled && Object.keys(chat.state).length > 0) {
      var stateLines = Object.keys(chat.state).map(function (k) { return '- ' + k + '：' + chat.state[k]; }).join('\n');
      messages.push({ role: 'system', content: '【当前角色状态】\n' + stateLines + '\n（请据此自然演绎角色的情绪与态度）' });
    }
    var docContext = buildDocumentContext(chat, CFG.maxDocumentContextChars);
    if (docContext) messages.push({ role: 'system', content: docContext });
    if (chat.summary) messages.push({ role: 'system', content: '【早期对话摘要】\n' + chat.summary });
    var history = (chat.messages || [])
      .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
      .slice(-CFG.maxHistoryMessages);
    messages = messages.concat(history);
    return messages;
  }

  /* ---------------- 文件导入解析（移植 server/fileImport.js） ---------------- */

  var ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    hellip: '…', mdash: '—', ndash: '–', middot: '·', lsquo: '‘', rsquo: '’',
    ldquo: '“', rdquo: '”', copy: '©', reg: '®', deg: '°', times: '×', divide: '÷',
  };

  function decodeEntities(s) {
    return String(s)
      .replace(/&#(\d+);/g, function (m, d) { var n = Number(d); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { var n = parseInt(h, 16); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, function (m, name) { return Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : m; });
  }

  function decodeUtf8(bytes) {
    var arr = bytes;
    if (arr.length >= 3 && arr[0] === 0xef && arr[1] === 0xbb && arr[2] === 0xbf) arr = arr.slice(3);
    return new TextDecoder('utf-8').decode(arr);
  }

  function base64ToBytes(b64) {
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function cleanTextLines(s) {
    var out = [];
    String(s).split(/\r?\n/).forEach(function (line) {
      var t = line.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    });
    return out.join('\n');
  }

  function htmlToText(html) {
    var s = String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<br\s*\/?\s*>/gi, '\n');
    s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre|ul|ol)>\s*/gi, '\n');
    s = s.replace(/<[^>]*>/g, '');
    return cleanTextLines(decodeEntities(s));
  }

  function rtfToText(text) {
    var s = String(text);
    s = s.replace(/\\par\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\tab\b/g, '\t');
    s = s.replace(/\\u(-?\d+)\s?/g, function (m, n) {
      var code = Number(n) & 0xffff;
      return code > 0 ? String.fromCharCode(code) : '';
    });
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
    s = s.replace(/\\([a-zA-Z]+-?\d*)\s?/g, '');
    s = s.replace(/\\([^a-zA-Z\\{}])\s?/g, '$1');
    s = s.replace(/[{}]/g, '');
    return cleanTextLines(s);
  }

  function docxToText(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DOCX_UNSUPPORTED');
    }
    var buf = bytes;
    var eocd = -1;
    for (var i = buf.length - 22; i >= 0; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('不是有效的 zip/docx 文件');
    var view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var entryCount = view.getUint16(eocd + 10, true);
    var centralOffset = view.getUint32(eocd + 16, true);
    var offset = centralOffset;
    var target = null;
    for (var j = 0; j < entryCount; j++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('zip 中央目录损坏');
      var method = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = decodeUtf8(buf.subarray(offset + 46, offset + 46 + nameLen));
      if (name === 'word/document.xml') {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('zip 本地文件头损坏');
        var lNameLen = view.getUint16(localOffset + 26, true);
        var lExtraLen = view.getUint16(localOffset + 28, true);
        var dataStart = localOffset + 30 + lNameLen + lExtraLen;
        target = { method: method, raw: buf.subarray(dataStart, dataStart + compressedSize) };
        break;
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    if (!target) throw new Error('docx 中未找到 word/document.xml');
    var xmlBytes;
    if (target.method === 0) xmlBytes = target.raw;
    else if (target.method === 8) {
      // 异步解压（DecompressionStream('deflate-raw')）；await 后返回
      xmlBytes = null;
      target.needsInflate = true;
    } else throw new Error('不支持的压缩方式：' + target.method);
    // 用 async 包装处理 inflate
    return Promise.resolve().then(async function () {
      var xml;
      if (xmlBytes) {
        xml = decodeUtf8(xmlBytes);
      } else {
        var ds = new DecompressionStream('deflate-raw');
        var stream = new Blob([target.raw]).stream().pipeThrough(ds);
        var inflated = new Uint8Array(await new Response(stream).arrayBuffer());
        xml = decodeUtf8(inflated);
      }
      var s = xml
        .replace(/<w:tab[^>]*\/>/gi, '\t')
        .replace(/<w:br[^>]*\/>/gi, '\n')
        .replace(/<\/w:p>/gi, '\n');
      s = s.replace(/<[^>]*>/g, '');
      return cleanTextLines(decodeEntities(s));
    });
  }

  var IMPORT_EXTS = ['.txt', '.md', '.markdown', '.json', '.html', '.htm', '.rtf', '.docx'];

  async function parseImportFile(filename, bytes) {
    var ext = ('.' + String(filename).split('.').pop()).toLowerCase();
    if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
      return { content: decodeUtf8(bytes), format: ext === '.txt' ? 'txt' : 'md', warnings: [] };
    }
    if (ext === '.json') {
      var obj;
      try { obj = JSON.parse(decodeUtf8(bytes)); } catch (e) { throw new Error('JSON 解析失败'); }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        var keys = ['content', 'persona', 'description'];
        for (var i = 0; i < keys.length; i++) {
          if (typeof obj[keys[i]] === 'string' && obj[keys[i]].trim()) {
            return { content: obj[keys[i]], format: 'json', warnings: [] };
          }
        }
      }
      return {
        content: JSON.stringify(obj, null, 2),
        format: 'json',
        warnings: ['JSON 中未找到 content/persona/description 字段，已返回格式化后的 JSON 原文'],
      };
    }
    if (ext === '.html' || ext === '.htm') {
      return { content: htmlToText(decodeUtf8(bytes)), format: 'html', warnings: [] };
    }
    if (ext === '.rtf') {
      return { content: rtfToText(decodeUtf8(bytes)), format: 'rtf', warnings: [] };
    }
    if (ext === '.docx') {
      var text;
      try {
        text = await docxToText(bytes);
      } catch (e) {
        if (e && e.message === 'DOCX_UNSUPPORTED') {
          throw new Error('DOCX_UNSUPPORTED');
        }
        throw new Error('docx 解析失败：' + e.message);
      }
      return { content: text, format: 'docx', warnings: [] };
    }
    throw new Error('不支持的文件格式：' + ext);
  }

  /* ---------------- 启发式人设提取（移植 parseTranscript.js） ---------------- */

  function splitTurns(text) {
    var label = /^\s*(?:【(用户|助手)】|(user|assistant|用户|助手)\s*[:：])\s*(.*)$/i;
    var turns = [];
    var cur = null;
    String(text).split(/\r?\n/).forEach(function (line) {
      var m = label.exec(line);
      if (m) {
        if (cur) turns.push(cur);
        var roleTxt = (m[1] || m[2] || '').toLowerCase();
        var role = roleTxt.charAt(0) === 'u' || roleTxt === '用户' ? 'user' : 'assistant';
        var content = (m[3] || '').trim();
        cur = content ? { role: role, content: content } : null;
      } else if (cur) {
        cur.content += '\n' + line;
      }
    });
    if (cur) turns.push(cur);
    return turns.filter(function (t) { return t.content.trim(); });
  }

  function heuristicExtract(transcript) {
    var turns = splitTurns(transcript);
    if (!turns.length) return '';
    var KEYWORD = /设定|人设|扮演|你是|角色|身份/;
    var best = null;
    turns.forEach(function (t) {
      if (!KEYWORD.test(t.content)) return;
      if (!best || t.content.length > best.content.length) best = t;
    });
    if (best) return best.content.slice(0, 4000);
    var ROLE_LINE = /(?:我是|我扮演|我的身份|我的角色|我的设定|我的人设|作为一个?|扮演)/;
    var roleLines = [];
    turns.forEach(function (t) {
      if (t.role !== 'assistant') return;
      t.content.split('\n').forEach(function (line) {
        var s = line.trim();
        if (s && ROLE_LINE.test(s)) roleLines.push(s);
      });
    });
    if (roleLines.length) return roleLines.slice(0, 5).join('\n');
    var firstAssistant = turns.find(function (t) { return t.role === 'assistant'; });
    if (firstAssistant) return firstAssistant.content.slice(0, 4000);
    var first = turns.find(function (t) { return t.content.trim(); });
    return first ? first.content.slice(0, 4000) : '';
  }

  /* ---------------- 导出文本（移植 server 8.2） ---------------- */

  function sanitizeFilename(s) {
    var cleaned = String(s == null ? '' : s).replace(/[\\/:*?"<>|\r\n\t\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
    return cleaned || 'chat';
  }

  function dateInShanghai() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (e) {
      var d = new Date();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    }
  }

  function toMarkdown(chat) {
    var lines = ['# ' + chat.title, '', '> 人设：' + (chat.personaName || '（已删除）'), ''];
    (chat.messages || []).forEach(function (m) {
      lines.push(m.role === 'user' ? '## 我' : '## 助手', '', m.content, '', '> ' + m.ts, '');
    });
    return lines.join('\n');
  }

  function toPlainText(chat) {
    return (chat.messages || []).map(function (m) {
      return '[' + (m.role === 'user' ? '我' : '助手') + '] ' + m.content;
    }).join('\n\n') + '\n';
  }

  /* ---------------- 合成用户与认证占位 ---------------- */

  function syntheticUser(settings) {
    return {
      username: LOCAL_USERNAME,
      role: 'user',
      expiry: null,
      disabled: false,
      expired: false,
      status: 'active',
      createdAt: BOOT_TIME,
      lastLogin: BOOT_TIME,
      hasApiKey: !!(settings && settings.apiKey),
      model: (settings && settings.model) || 'deepseek-chat',
    };
  }

  /* ---------------- Api 表面 ---------------- */

  var api = {
    /* 认证占位（本机版无账号体系） */
    status: async function () {
      var s = await getSettings();
      return {
        loggedIn: true,
        setupRequired: false,
        allowRegistration: false,
        server: serverInfo(),
        user: syntheticUser(s),
      };
    },
    me: async function () {
      var s = await getSettings();
      return {
        user: syntheticUser(s),
        setupRequired: false,
        allowRegistration: false,
        server: serverInfo(),
      };
    },
    setup: async function () { return { user: syntheticUser(await getSettings()) }; },
    register: async function () { return { user: syntheticUser(await getSettings()) }; },
    login: async function () { return { user: syntheticUser(await getSettings()) }; },
    logout: async function () { return null; },
    heartbeat: async function () { return { ok: true }; },
    changePassword: async function () { return null; },

    /* 人设 */
    personas: async function () {
      var arr = await getPersonas();
      return {
        personas: arr.map(function (p) {
          var n = normalizePersona(p);
          return { id: n.id, name: n.name, size: n.size, updatedAt: n.updatedAt, avatarUrl: n.avatarUrl };
        }),
      };
    },
    persona: async function (id) {
      var arr = await getPersonas();
      var p = findPersona(arr, id);
      if (!p) fail('人设不存在', 'NOT_FOUND', 404);
      return { persona: normalizePersona(p) };
    },
    createPersona: async function (data) {
      data = data || {};
      var name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 50) fail('人设名称需为 1-50 字符', 'VALIDATION', 400, {}, { toast: false });
      if (typeof data.content !== 'string' || data.content.length < 1 || data.content.length > 200000) {
        fail('人设内容需为 1-200000 字符', 'VALIDATION', 400, {}, { toast: false });
      }
      var attributes = cleanKeyValueList(data.attributes, '人物属性');
      var stateAttributes = cleanKeyValueList(data.stateAttributes, '状态属性');
      var stateEnabled = data.stateEnabled === undefined ? false : data.stateEnabled;
      if (typeof stateEnabled !== 'boolean') fail('stateEnabled 需为布尔值', 'VALIDATION', 400, {}, { toast: false });
      var rec = {
        id: genId(),
        name: name,
        content: data.content,
        attributes: attributes,
        stateAttributes: stateAttributes,
        stateEnabled: stateEnabled,
        avatarUrl: null,
        updatedAt: nowIso(),
      };
      rec.size = byteLen(buildPersonaText(rec.content, rec.attributes, rec.stateAttributes));
      var arr = await getPersonas();
      arr.push(rec);
      await savePersonas(arr);
      return { persona: normalizePersona(rec) };
    },
    updatePersona: async function (id, data) {
      data = data || {};
      var arr = await getPersonas();
      var rec = findPersona(arr, id);
      if (!rec) fail('人设不存在', 'NOT_FOUND', 404, {}, { toast: false });
      var hasName = data.name !== undefined;
      var hasContent = data.content !== undefined;
      var hasAttributes = data.attributes !== undefined;
      var hasStateAttributes = data.stateAttributes !== undefined;
      var hasStateEnabled = data.stateEnabled !== undefined;
      if (!hasName && !hasContent && !hasAttributes && !hasStateAttributes && !hasStateEnabled) {
        fail('至少提供 name、content、attributes、stateAttributes 或 stateEnabled 之一', 'VALIDATION', 400, {}, { toast: false });
      }
      if (hasName) {
        var nm = typeof data.name === 'string' ? data.name.trim() : '';
        if (!nm || nm.length > 50) fail('人设名称需为 1-50 字符', 'VALIDATION', 400, {}, { toast: false });
        rec.name = nm;
      }
      if (hasContent) {
        if (typeof data.content !== 'string' || data.content.length < 1 || data.content.length > 200000) {
          fail('人设内容需为 1-200000 字符', 'VALIDATION', 400, {}, { toast: false });
        }
        rec.content = data.content;
      }
      if (hasAttributes) rec.attributes = cleanKeyValueList(data.attributes, '人物属性');
      if (hasStateAttributes) rec.stateAttributes = cleanKeyValueList(data.stateAttributes, '状态属性');
      if (hasStateEnabled) {
        if (typeof data.stateEnabled !== 'boolean') fail('stateEnabled 需为布尔值', 'VALIDATION', 400, {}, { toast: false });
        rec.stateEnabled = data.stateEnabled;
      }
      rec.size = byteLen(buildPersonaText(rec.content, rec.attributes, rec.stateAttributes));
      rec.updatedAt = nowIso();
      await savePersonas(arr);
      return { persona: normalizePersona(rec) };
    },
    deletePersona: async function (id) {
      var arr = await getPersonas();
      var before = arr.length;
      var next = arr.filter(function (p) { return p.id !== id; });
      if (next.length === before) fail('人设不存在', 'NOT_FOUND', 404, {}, { toast: false });
      await savePersonas(next);
      return null;
    },
    uploadPersonaAvatar: async function (id, dataUrl) {
      var arr = await getPersonas();
      var rec = findPersona(arr, id);
      if (!rec) fail('人设不存在', 'NOT_FOUND', 404, {}, { toast: false });
      if (typeof dataUrl !== 'string') fail('请提供头像图片（base64 dataURL）', 'VALIDATION', 400, {}, { toast: false });
      var m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
      if (!m) fail('头像需为 base64 编码的 dataURL 图片', 'VALIDATION', 400, {}, { toast: false });
      var bytes;
      try { bytes = base64ToBytes(m[2]); } catch (e) { fail('头像 base64 解码失败', 'VALIDATION', 400, {}, { toast: false }); }
      if (bytes.length > CFG.maxAvatarBytes) {
        fail('头像大小不能超过 ' + Math.round(CFG.maxAvatarBytes / 1024) + 'KB', 'VALIDATION', 400, {}, { toast: false });
      }
      // magic bytes 校验（不信任声明 mime）
      var isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
      var isJpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!isPng && !isJpg) fail('头像仅支持 PNG 或 JPEG 图片', 'VALIDATION', 400, {}, { toast: false });
      rec.avatarUrl = dataUrl.trim();
      await savePersonas(arr);
      return { persona: normalizePersona(rec) };
    },
    deletePersonaAvatar: async function (id) {
      var arr = await getPersonas();
      var rec = findPersona(arr, id);
      if (!rec) fail('人设不存在', 'NOT_FOUND', 404, {}, { toast: false });
      rec.avatarUrl = null;
      await savePersonas(arr);
      return null;
    },
    importPersonaFile: async function (filename, dataBase64) {
      if (typeof filename !== 'string' || !filename.trim() || typeof dataBase64 !== 'string') {
        fail('请提供文件名与文件内容', 'VALIDATION', 400, {}, { toast: false });
      }
      var fname = filename.trim();
      var ext = ('.' + fname.split('.').pop()).toLowerCase();
      if (IMPORT_EXTS.indexOf(ext) < 0) {
        fail('仅支持 .txt / .md / .markdown / .json / .html / .htm / .rtf / .docx 格式的文件', 'VALIDATION', 400, {}, { toast: false });
      }
      var bytes;
      try { bytes = base64ToBytes(dataBase64); } catch (e) { fail('文件内容 base64 解码失败', 'PARSE_FAILED', 400, {}, { toast: false }); }
      if (bytes.length > CFG.maxPersonaImportBytes) {
        fail('文件大小不能超过 ' + Math.round(CFG.maxPersonaImportBytes / 1024) + 'KB', 'VALIDATION', 400, {}, { toast: false });
      }
      var result;
      try {
        result = await parseImportFile(fname, bytes);
      } catch (e) {
        if (e && e.message === 'DOCX_UNSUPPORTED') {
          fail('本机版暂不支持 docx（可用 txt/md 导入）', 'VALIDATION', 400, {}, { toast: false });
        }
        fail('文件解析失败：' + (e && e.message ? e.message : '未知错误'), 'PARSE_FAILED', 400, {}, { toast: false });
      }
      return { content: result.content, filename: fname, format: result.format, warnings: result.warnings };
    },

    /* 聊天 */
    chats: async function () {
      var arr = await getChats();
      var personas = await getPersonas();
      var chats = arr.map(function (c) {
        var chat = normalizeChat(c);
        var p = findPersona(personas, chat.personaId);
        return {
          id: chat.id,
          title: chat.title,
          personaId: chat.personaId,
          personaName: chat.personaName,
          personaAvatar: p ? p.avatarUrl : null,
          model: chat.model,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          messageCount: chat.messages.length,
        };
      });
      chats.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0; });
      return { chats: chats };
    },
    chat: async function (id) {
      var arr = await getChats();
      var rec = findChat(arr, id);
      if (!rec) fail('聊天不存在', 'NOT_FOUND', 404);
      return { chat: normalizeChat(rec) };
    },
    createChat: async function (data) {
      data = data || {};
      var personas = await getPersonas();
      var persona = findPersona(personas, data.personaId);
      if (!persona) fail('人设不存在', 'NOT_FOUND', 404);
      var settings = await getSettings();
      var title = persona.name;
      if (data.title !== undefined && data.title !== null) {
        if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 200) {
          fail('标题需为 1-200 字符', 'VALIDATION', 400);
        }
        title = data.title.trim();
      }
      var model = settings.model || 'deepseek-chat';
      if (data.model !== undefined && data.model !== null) {
        if (MODELS.indexOf(data.model) < 0) fail('模型不在允许列表内', 'VALIDATION', 400);
        model = data.model;
      }
      var fields = resolveChatFields(data, {
        mode: 'chat', minReplyChars: CFG.defaultReplyMin, maxReplyChars: CFG.defaultReplyMax,
        storyMinChars: CFG.defaultStoryMin, storyMaxChars: CFG.defaultStoryMax,
        envDescriptionEnabled: true, envDescriptionChars: CFG.defaultEnvDescriptionChars,
        novelMinChars: CFG.defaultNovelMin, novelMaxChars: CFG.defaultNovelMax,
        reasoningLevel: CFG.defaultReasoningLevel,
      });
      var selfPersona = data.selfPersona !== undefined
        ? (typeof data.selfPersona === 'string' ? data.selfPersona.trim() : (fail('selfPersona 需为字符串', 'VALIDATION', 400), ''))
        : (settings.defaultSelfPersona || '');
      if (selfPersona.length > CFG.maxSelfPersonaChars) {
        fail('selfPersona 最多 ' + CFG.maxSelfPersonaChars + ' 字符', 'VALIDATION', 400);
      }
      if (data.saveSelfPersonaAsDefault === true) {
        settings.defaultSelfPersona = selfPersona || null;
        await saveSettings(settings);
      }
      var stateEnabled = !!persona.stateEnabled && (persona.stateAttributes || []).length > 0;
      var state = {};
      if (stateEnabled) {
        (persona.stateAttributes || []).forEach(function (sa) { state[sa.key] = String(sa.value == null ? '' : sa.value); });
      }
      var chat = {
        id: genId(),
        title: title,
        personaId: persona.id,
        personaName: persona.name,
        model: model,
        mode: fields.mode,
        minReplyChars: fields.minReplyChars,
        maxReplyChars: fields.maxReplyChars,
        storyMinChars: fields.storyMinChars,
        storyMaxChars: fields.storyMaxChars,
        envDescriptionEnabled: fields.envDescriptionEnabled,
        envDescriptionChars: fields.envDescriptionChars,
        novelMinChars: fields.novelMinChars,
        novelMaxChars: fields.novelMaxChars,
        reasoningLevel: fields.reasoningLevel,
        selfPersona: selfPersona,
        stateEnabled: stateEnabled,
        state: state,
        documents: [],
        summary: null,
        summaryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messages: [],
      };
      var arr = await getChats();
      arr.push(chat);
      await saveChats(arr);
      return { chat: normalizeChat(chat) };
    },
    updateChat: async function (id, data) {
      data = data || {};
      var arr = await getChats();
      var rec = findChat(arr, id);
      if (!rec) fail('聊天不存在', 'NOT_FOUND', 404);
      var base = normalizeChat(rec);
      var hasAny = false;
      ['title', 'selfPersona', 'saveAsDefault', 'mode', 'minReplyChars', 'maxReplyChars',
        'storyMinChars', 'storyMaxChars', 'envDescriptionEnabled', 'envDescriptionChars',
        'novelMinChars', 'novelMaxChars', 'reasoningLevel'].forEach(function (k) {
          if (data[k] !== undefined) hasAny = true;
        });
      if (!hasAny) fail('至少提供一个可更新的字段', 'VALIDATION', 400);
      if (data.title !== undefined) {
        if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 200) {
          fail('标题需为 1-200 字符', 'VALIDATION', 400);
        }
        rec.title = data.title.trim();
      }
      var fields = resolveChatFields(data, base);
      rec.mode = fields.mode;
      rec.minReplyChars = fields.minReplyChars;
      rec.maxReplyChars = fields.maxReplyChars;
      rec.storyMinChars = fields.storyMinChars;
      rec.storyMaxChars = fields.storyMaxChars;
      rec.envDescriptionEnabled = fields.envDescriptionEnabled;
      rec.envDescriptionChars = fields.envDescriptionChars;
      rec.novelMinChars = fields.novelMinChars;
      rec.novelMaxChars = fields.novelMaxChars;
      rec.reasoningLevel = fields.reasoningLevel;
      if (data.selfPersona !== undefined) {
        if (typeof data.selfPersona !== 'string') fail('selfPersona 需为字符串', 'VALIDATION', 400);
        var sp = data.selfPersona.trim();
        if (sp.length > CFG.maxSelfPersonaChars) fail('selfPersona 最多 ' + CFG.maxSelfPersonaChars + ' 字符', 'VALIDATION', 400);
        rec.selfPersona = sp;
      }
      if (data.saveAsDefault === true) {
        var settings = await getSettings();
        settings.defaultSelfPersona = (rec.selfPersona || null);
        await saveSettings(settings);
      }
      await saveChats(arr);
      return { chat: normalizeChat(rec) };
    },
    deleteChat: async function (id) {
      var arr = await getChats();
      var before = arr.length;
      var next = arr.filter(function (c) { return c.id !== id; });
      if (next.length === before) fail('聊天不存在', 'NOT_FOUND', 404);
      await saveChats(next);
      return null;
    },
    summarizeChat: async function (id, opts) {
      var arr = await getChats();
      var rec = findChat(arr, id);
      if (!rec) fail('聊天不存在', 'NOT_FOUND', 404, {}, { toast: false });
      var keep = CFG.summarizeKeepRecent;
      if (opts && typeof opts.keepRecent === 'number') {
        if (!Number.isInteger(opts.keepRecent) || opts.keepRecent < 1 || opts.keepRecent > CFG.maxHistoryMessages) {
          fail('keepRecent 需为 1-' + CFG.maxHistoryMessages + ' 之间的整数', 'VALIDATION', 400, {}, { toast: false });
        }
        keep = opts.keepRecent;
      }
      var messages = Array.isArray(rec.messages) ? rec.messages : [];
      var old = messages.slice(0, Math.max(0, messages.length - keep));
      var recent = messages.slice(-keep);
      if (!old.length) fail('没有可压缩的早期历史', 'NOTHING_TO_SUMMARIZE', 400, {}, { toast: false });
      var settings = await getSettings();
      if (!settings.apiKey) fail('未配置 API Key，请先在设置中填写', 'NO_API_KEY', 400, {}, { toast: false });
      var historyText = old.map(function (m) {
        return '[' + (m.role === 'user' ? '用户' : '助手') + '] ' + m.content;
      }).join('\n');
      var text = historyText;
      var truncatedNote = '';
      if (text.length > CFG.summarizeMaxChars) {
        text = text.slice(text.length - CFG.summarizeMaxChars);
        truncatedNote = '（注：早期对话过长，已截去最旧部分）';
      }
      var parts = [];
      if (rec.summary) parts.push('既有摘要：\n' + rec.summary);
      parts.push('新对话记录' + truncatedNote + '：\n' + text);
      var summary;
      try {
        summary = (await completionText({
          apiKey: settings.apiKey,
          model: CFG.summarizeModel,
          messages: [
            { role: 'system', content: CFG.summarizeSystemPrompt },
            { role: 'user', content: parts.join('\n\n') },
          ],
        })).trim();
      } catch (e) {
        fail(e.message || '生成摘要失败，请稍后重试', 'LLM_ERROR', e.status || 500, {}, { toast: false });
      }
      if (!summary) fail('生成摘要失败：模型返回为空', 'LLM_ERROR', 500, {}, { toast: false });
      rec.summary = summary;
      rec.summaryAt = nowIso();
      rec.messages = recent;
      rec.updatedAt = nowIso();
      await saveChats(arr);
      return { chat: normalizeChat(rec), summary: summary, removedCount: old.length };
    },

    /* 文档（契约 18，本机 200KB 限制） */
    uploadDocument: async function (chatId, data) {
      data = data || {};
      var arr = await getChats();
      var rec = findChat(arr, chatId);
      if (!rec) fail('聊天不存在', 'NOT_FOUND', 404, {}, { toast: false });
      var fname = typeof data.filename === 'string' ? data.filename.trim() : '';
      if (!fname || fname.length > 200) fail('文件名需为 1-200 字符', 'VALIDATION', 400, {}, { toast: false });
      if (typeof data.content !== 'string' || data.content.length < 1 || data.content.length > CFG.maxDocumentChars) {
        fail('文档内容需为 1-' + CFG.maxDocumentChars + ' 字符', 'VALIDATION', 400, {}, { toast: false });
      }
      var docs = Array.isArray(rec.documents) ? rec.documents : [];
      if (docs.length >= CFG.maxDocumentsPerChat) {
        fail('每个聊天最多上传 ' + CFG.maxDocumentsPerChat + ' 个文档', 'VALIDATION', 400, {}, { toast: false });
      }
      var document = { id: genId(), filename: fname, content: data.content, ts: nowIso() };
      rec.documents = docs.concat([document]);
      await saveChats(arr);
      return { chat: normalizeChat(rec), document: document };
    },
    analyzeDocument: async function (chatId, docId) {
      var arr = await getChats();
      var rec = findChat(arr, chatId);
      if (!rec) fail('聊天不存在', 'NOT_FOUND', 404, {}, { toast: false });
      var docs = Array.isArray(rec.documents) ? rec.documents : [];
      var document = docs.find(function (d) { return d.id === docId; }) || null;
      if (!document) fail('文档不存在', 'NOT_FOUND', 404, {}, { toast: false });
      var settings = await getSettings();
      if (!settings.apiKey) fail('未配置 API Key，请先在设置中填写', 'NO_API_KEY', 400, {}, { toast: false });
      var text;
      try {
        text = await completionText({
          apiKey: settings.apiKey,
          model: CFG.docAnalyzeModel,
          messages: [
            { role: 'system', content: CFG.docAnalyzeSystemPrompt },
            { role: 'user', content: document.content.slice(0, CFG.maxDocumentChars) },
          ],
        });
      } catch (e) {
        fail(e.message || '分析文档失败，请稍后重试', 'LLM_ERROR', e.status || 500, {}, { toast: false });
      }
      var relevant = false;
      var snippet = '';
      var message = '未检测到人设相关内容';
      var parsed = extractJsonObject(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        relevant = parsed.relevant === true || String(parsed.relevant).toLowerCase() === 'true';
        snippet = typeof parsed.snippet === 'string' ? parsed.snippet : '';
        message = relevant
          ? '检测到文档可能包含人设相关内容'
          : (typeof parsed.message === 'string' && parsed.message ? parsed.message : '未检测到人设相关内容');
      } else {
        message = '模型返回无法解析，按未检测到人设内容处理';
      }
      return { relevant: relevant, snippet: snippet, message: message };
    },
    applyDocument: async function (chatId, docId, snippet) {
      var arr = await getChats();
      var rec = findChat(arr, chatId);
      if (!rec) fail('聊天不存在', 'NOT_FOUND', 404, {}, { toast: false });
      var docs = Array.isArray(rec.documents) ? rec.documents : [];
      var document = docs.find(function (d) { return d.id === docId; }) || null;
      if (!document) fail('文档不存在', 'NOT_FOUND', 404, {}, { toast: false });
      if (typeof snippet !== 'string' || snippet.length < 1 || snippet.length > CFG.maxDocumentChars) {
        fail('snippet 需为 1-' + CFG.maxDocumentChars + ' 字符', 'VALIDATION', 400, {}, { toast: false });
      }
      var personas = await getPersonas();
      var persona = findPersona(personas, rec.personaId);
      if (!persona) fail('该聊天的人设已被删除，无法追加', 'NOT_FOUND', 404, {}, { toast: false });
      persona.content = persona.content + '\n\n（来自文档《' + document.filename + '》追加）\n' + snippet;
      persona.size = byteLen(buildPersonaText(persona.content, persona.attributes, persona.stateAttributes));
      persona.updatedAt = nowIso();
      await savePersonas(personas);
      return { persona: normalizePersona(persona) };
    },

    /* 设置 */
    settings: async function () {
      var s = await getSettings();
      return {
        hasApiKey: !!s.apiKey,
        apiKeyMasked: maskApiKey(s.apiKey),
        model: s.model || 'deepseek-chat',
        docSuggestionEnabled: s.docSuggestionEnabled,
        defaultSelfPersona: s.defaultSelfPersona,
      };
    },
    updateSettings: async function (data) {
      data = data || {};
      var s = await getSettings();
      if (data.apiKey !== undefined) {
        if (data.apiKey === null || data.apiKey === '') s.apiKey = null;
        else if (typeof data.apiKey === 'string') s.apiKey = data.apiKey.trim() || null;
        else fail('apiKey 需为字符串或 null', 'VALIDATION', 400, {}, { toast: false });
      }
      if (data.model !== undefined) {
        if (MODELS.indexOf(data.model) < 0) fail('模型需在允许列表内（deepseek-chat / deepseek-reasoner）', 'VALIDATION', 400, {}, { toast: false });
        s.model = data.model;
      }
      if (data.docSuggestionEnabled !== undefined) {
        if (typeof data.docSuggestionEnabled !== 'boolean') fail('docSuggestionEnabled 需为布尔值', 'VALIDATION', 400, {}, { toast: false });
        s.docSuggestionEnabled = data.docSuggestionEnabled;
      }
      if (data.defaultSelfPersona !== undefined) {
        if (data.defaultSelfPersona === null || data.defaultSelfPersona === '') s.defaultSelfPersona = null;
        else if (typeof data.defaultSelfPersona === 'string') {
          var sp = data.defaultSelfPersona.trim();
          if (sp.length > CFG.maxSelfPersonaChars) fail('defaultSelfPersona 最多 ' + CFG.maxSelfPersonaChars + ' 字符', 'VALIDATION', 400, {}, { toast: false });
          s.defaultSelfPersona = sp || null;
        } else fail('defaultSelfPersona 需为字符串或 null', 'VALIDATION', 400, {}, { toast: false });
      }
      await saveSettings(s);
      return api.settings();
    },
    models: async function () {
      return { models: MODELS.slice() };
    },
    testKey: async function (apiKey) {
      var s = await getSettings();
      var key = (apiKey !== undefined && apiKey !== null) ? String(apiKey).trim() : s.apiKey;
      if (!key) return { ok: false, message: '未配置 API Key，请先在设置中填写' };
      return testDeepSeekKey(key);
    },

    /* 导入 */
    importFetch: async function () {
      fail('本机版不支持按链接抓取（浏览器跨域限制），请改为粘贴对话内容', 'FETCH_BLOCKED', 400, {}, { toast: false });
    },
    importExtract: async function (transcript, title) {
      if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 500000) {
        fail('请提供有效的对话内容', 'VALIDATION', 400, {}, { toast: false });
      }
      var s = await getSettings();
      if (!s.apiKey) {
        return {
          suggestion: heuristicExtract(transcript),
          source: 'heuristic',
          warning: '未配置 API Key，仅做启发式提取，可能不完整；建议先在设置中配置 Key 后重新提取。',
        };
      }
      try {
        var content = await completionText({
          apiKey: s.apiKey,
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: CFG.extractSystemPrompt },
            { role: 'user', content: transcript.slice(0, 200000) },
          ],
        });
        var suggestion = String(content || '').trim();
        if (!suggestion) throw new Error('模型返回为空');
        return { suggestion: suggestion, source: 'llm', warning: null };
      } catch (e) {
        return {
          suggestion: heuristicExtract(transcript),
          source: 'heuristic',
          warning: '大模型提取失败（' + (e.message || '未知错误') + '），已回退启发式提取，结果可能不完整。',
        };
      }
    },

    /* 管理占位（本机版无管理员） */
    adminAccounts: async function () { return { accounts: [] }; },
    adminCreateAccount: async function () { fail('本机版不支持管理员功能', 'FORBIDDEN', 403); },
    adminUpdateAccount: async function () { fail('本机版不支持管理员功能', 'FORBIDDEN', 403); },
    adminDeleteAccount: async function () { fail('本机版不支持管理员功能', 'FORBIDDEN', 403); },
    adminSettings: async function () { return { allowRegistration: false, server: serverInfo() }; },
    adminUpdateSettings: async function () { fail('本机版不支持管理员功能', 'FORBIDDEN', 403); },
    adminOnline: async function () { return { online: [], count: 0 }; },
    adminUserChats: async function (username) { return { username: username, chats: [] }; },
    adminUserChat: async function () { fail('本机版不支持管理员功能', 'FORBIDDEN', 403); },
    adminUserPersonas: async function (username) { return { username: username, personas: [] }; },
    adminUserPersona: async function () { fail('本机版不支持管理员功能', 'FORBIDDEN', 403); },
  };

  /* ---------------- 流式聊天（契约 34：直连 DeepSeek SSE） ---------------- */

  async function streamChat(id, content, handlers, signal) {
    handlers = handlers || {};
    if (typeof content !== 'string' || content.length < 1 || content.length > 50000) {
      fail('消息内容需为 1-50000 字符', 'VALIDATION', 400);
    }
    var arr = await getChats();
    var rec = findChat(arr, id);
    if (!rec) fail('聊天不存在', 'NOT_FOUND', 404);
    var settings = await getSettings();
    if (!settings.apiKey) {
      fail('未配置 API Key，请先在设置中填写', 'NO_API_KEY', 400);
    }
    var chat = normalizeChat(rec);

    // 保存用户消息
    var userMsg = { id: genId(), role: 'user', content: content, ts: nowIso() };
    chat.messages = chat.messages.concat([userMsg]);
    chat.updatedAt = nowIso();
    // 先落盘用户消息（与服务器版一致：上游失败时用户消息仍保留）
    rec.messages = chat.messages;
    rec.updatedAt = chat.updatedAt;
    await saveChats(arr);

    // 隐藏状态更新（契约 17）：stateEnabled 且 state 非空时先做一次非流式更新，失败忽略
    if (chat.stateEnabled && Object.keys(chat.state).length > 0) {
      try {
        var recent = chat.messages
          .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
          .slice(-CFG.stateUpdateContextMessages)
          .map(function (m) { return '[' + (m.role === 'user' ? '用户' : '助手') + '] ' + m.content; })
          .join('\n');
        var stateText = await completionText({
          apiKey: settings.apiKey,
          model: CFG.stateUpdateModel,
          messages: [
            { role: 'system', content: CFG.stateUpdateSystemPrompt },
            { role: 'user', content: '当前状态 JSON：\n' + JSON.stringify(chat.state) + '\n\n最近对话：\n' + recent },
          ],
        });
        var parsed = extractJsonObject(stateText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          Object.keys(chat.state).forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] !== undefined) {
              chat.state[key] = String(parsed[key]);
            }
          });
        }
      } catch (e) { /* 忽略：状态更新失败不阻断回复 */ }
    }

    var personas = await getPersonas();
    var persona = findPersona(personas, chat.personaId);
    var messages = await buildChatMessages(chat, persona);

    var assistantId = genId();
    if (handlers.onMeta) handlers.onMeta({ type: 'meta', messageId: assistantId, model: chat.model });

    var res;
    try {
      res = await fetch(joinUrl(CFG.deepseekBaseUrl, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
        body: JSON.stringify({ model: chat.model, messages: messages, stream: true }),
        signal: signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError('无法连接 DeepSeek：' + (e && e.message ? e.message : '网络错误，请重试'), 'LLM_ERROR', 0, {});
    }

    if (!res.ok) {
      throw await upstreamError(res);
    }

    var full = '';
    var ctype = String((res.headers && res.headers.get ? res.headers.get('content-type') : '') || '').toLowerCase();
    if (ctype.indexOf('text/event-stream') >= 0) {
      var reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) {
        throw new ApiError('当前浏览器不支持流式响应', 'LLM_ERROR', 0, {});
      }
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      for (;;) {
        var chunk;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          throw new ApiError('读取 DeepSeek 响应失败', 'LLM_ERROR', 0, {});
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          var line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line.slice(0, 5) !== 'data:') continue;
          var payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') { buffer = ''; break; }
          var obj = null;
          try { obj = JSON.parse(payload); } catch (e) { continue; }
          var delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
          // 忽略 reasoning_content，只取正式回答
          var piece = delta && typeof delta.content === 'string' ? delta.content : '';
          if (piece) {
            full += piece;
            if (handlers.onDelta) handlers.onDelta({ type: 'delta', content: piece });
          }
        }
      }
    } else {
      // 兜底：上游返回非流式 JSON
      var dj = null;
      try { dj = await res.json(); } catch (e) { dj = null; }
      var dc = dj && dj.choices && dj.choices[0] && dj.choices[0].message && dj.choices[0].message.content;
      if (typeof dc === 'string' && dc) {
        full = dc;
        if (handlers.onDelta) handlers.onDelta({ type: 'delta', content: dc });
      }
    }

    // 落库：助手消息 + 更新 state/updatedAt
    var latestArr = await getChats();
    var latest = findChat(latestArr, id);
    var assistantMsg = { id: assistantId, role: 'assistant', content: full, ts: nowIso() };
    if (latest) {
      latest.messages = (Array.isArray(latest.messages) ? latest.messages : []).concat([assistantMsg]);
      latest.state = chat.state;
      latest.updatedAt = nowIso();
      await saveChats(latestArr);
    }
    if (handlers.onDone) {
      var doneEvt = { type: 'done', message: assistantMsg };
      if (chat.stateEnabled) doneEvt.state = chat.state;
      handlers.onDone(doneEvt);
    }
  }

  /* ---------------- 导出/备份 ---------------- */

  async function exportPersona(id) {
    var personas = await getPersonas();
    var rec = findPersona(personas, id);
    if (!rec) fail('人设不存在', 'NOT_FOUND', 404, {}, { toast: false });
    var text = buildPersonaText(rec.content, rec.attributes, rec.stateAttributes);
    return { filename: rec.name + '.txt', text: text };
  }

  async function exportChat(id, format) {
    var arr = await getChats();
    var rec = findChat(arr, id);
    if (!rec) fail('聊天不存在', 'NOT_FOUND', 404, {}, { toast: false });
    var chat = normalizeChat(rec);
    var fmt = String(format || 'md').toLowerCase();
    var text;
    var ext;
    if (fmt === 'md') { text = toMarkdown(chat); ext = 'md'; }
    else if (fmt === 'txt') { text = toPlainText(chat); ext = 'txt'; }
    else if (fmt === 'json') { text = JSON.stringify(chat, null, 2) + '\n'; ext = 'json'; }
    else fail('导出格式仅支持 md/txt/json', 'VALIDATION', 400, {}, { toast: false });
    var filename = 'chat-' + sanitizeFilename(chat.title) + '-' + dateInShanghai().replace(/-/g, '') + '.' + ext;
    return { filename: filename, text: text };
  }

  async function exportAllData() {
    return window.LocalStore.exportAll();
  }

  async function importAllData(json) {
    await window.LocalStore.importAll(json);
    return { ok: true };
  }

  window.Api = {
    api: api,
    streamChat: streamChat,
    ApiError: ApiError,
    exportPersona: exportPersona,
    exportChat: exportChat,
    exportAllData: exportAllData,
    importAllData: importAllData,
  };
})();
