/* ============================================================================
 * 本机版（无服务器）localStorage 数据层（契约 34）。
 * - 前缀 pcl:；键：pcl:settings / pcl:personas / pcl:chats。
 * - JSON 序列化；容量超限（QuotaExceededError）抛出友好错误。
 * - 提供导出/导入全部数据（备份/恢复）与 id 生成（crypto.randomUUID，回退随机）。
 * 用法：window.LocalStore.get(key, fallback) / set / remove / exportAll / importAll / clear / genId
 * ========================================================================== */
(function () {
  'use strict';

  var PREFIX = 'pcl:';
  var KEYS = ['settings', 'personas', 'chats'];
  var QUOTA_MESSAGE = '本机存储空间不足，请删除部分聊天或导出备份';

  var storage = (typeof localStorage !== 'undefined') ? localStorage : null;

  function quotaError(e) {
    var err = new Error(QUOTA_MESSAGE);
    err.name = 'QuotaExceededError';
    err.cause = e;
    return err;
  }

  function isQuota(e) {
    return !!(e
      && (e.name === 'QuotaExceededError'
        || e.code === 22
        || e.code === 1014
        || /quota/i.test(String(e && e.name) + String(e && e.message))));
  }

  function rawGet(key) {
    if (!storage) return null;
    return storage.getItem(PREFIX + key);
  }

  function rawSet(key, text) {
    if (!storage) {
      var noStorage = new Error('当前环境不支持本地存储');
      noStorage.name = 'StorageUnavailable';
      throw noStorage;
    }
    try {
      storage.setItem(PREFIX + key, text);
    } catch (e) {
      if (isQuota(e)) throw quotaError(e);
      throw e;
    }
  }

  /** 生成 UUID（优先 crypto.randomUUID，回退手写 v4）。 */
  function genId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    var b = (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
      ? crypto.getRandomValues(new Uint8Array(16))
      : null;
    var hex = [];
    for (var i = 0; i < 16; i++) {
      var v = b ? b[i] : Math.floor(Math.random() * 256);
      hex.push((i === 6 ? ((v & 0x0f) | 0x40) : i === 8 ? ((v & 0x3f) | 0x80) : v).toString(16).padStart(2, '0'));
    }
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('')
      + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  }

  window.LocalStore = {
    PREFIX: PREFIX,
    QUOTA_MESSAGE: QUOTA_MESSAGE,

    /** 读键；缺失/损坏时返回 fallback（不抛错）。 */
    async get(key, fallback) {
      var raw = rawGet(key);
      if (raw === null || raw === undefined) return typeof fallback === 'function' ? fallback() : fallback;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return typeof fallback === 'function' ? fallback() : fallback;
      }
    },

    /** 写键（JSON 序列化）；容量超限抛出友好错误。 */
    async set(key, value) {
      rawSet(key, JSON.stringify(value));
      return value;
    },

    /** 删除键。 */
    async remove(key) {
      if (storage) {
        try { storage.removeItem(PREFIX + key); } catch (e) { /* 忽略 */ }
      }
    },

    /** 导出全部本机数据（备份用）。 */
    async exportAll() {
      var out = { version: 1, exportedAt: new Date().toISOString() };
      out.settings = await window.LocalStore.get('settings', null);
      out.personas = await window.LocalStore.get('personas', []);
      out.chats = await window.LocalStore.get('chats', []);
      return out;
    },

    /** 导入备份（覆盖全部本机数据）；结构非法抛错。 */
    async importAll(json) {
      var data = json;
      if (!data || typeof data !== 'object') throw new Error('备份数据格式无效');
      // 兼容 {data:{...}} 包装
      if (data.data && typeof data.data === 'object' && (data.data.personas || data.data.chats || data.data.settings)) {
        data = data.data;
      }
      if (!Array.isArray(data.personas) && data.personas !== null && data.personas !== undefined) {
        throw new Error('备份数据格式无效：personas 需为数组');
      }
      if (!Array.isArray(data.chats) && data.chats !== null && data.chats !== undefined) {
        throw new Error('备份数据格式无效：chats 需为数组');
      }
      if (data.personas !== undefined) await window.LocalStore.set('personas', data.personas || []);
      if (data.chats !== undefined) await window.LocalStore.set('chats', data.chats || []);
      if (data.settings !== undefined) await window.LocalStore.set('settings', data.settings || {});
      return true;
    },

    /** 清空全部本机数据。 */
    async clear() {
      for (var i = 0; i < KEYS.length; i++) await window.LocalStore.remove(KEYS[i]);
    },

    genId: genId,
  };
})();
