/* 时间与时区工具：用于到期倒计时（契约 5 节）与各类格式化。 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  /**
   * 将某时区 tz 下的本地墙钟时间（y/mo/d h:mi:s）转换为 UTC 毫秒时间戳。
   * 通过 Intl.DateTimeFormat 求偏移并迭代收敛（兼容 DST）。
   */
  function zonedToUtc(y, mo, d, h, mi, s, tz) {
    tz = tz || 'Asia/Shanghai';
    var dtf;
    try {
      dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, hourCycle: 'h23',
      });
    } catch (e) {
      // 时区无效时退回 UTC 语义
      return Date.UTC(y, mo - 1, d, h, mi, s);
    }
    function asUtc(ms) {
      var parts = {};
      dtf.formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    }
    var guess = Date.UTC(y, mo - 1, d, h, mi, s);
    var offset = guess - asUtc(guess);
    var ms = guess + offset;
    for (var i = 0; i < 2; i++) {
      var off2 = ms - asUtc(ms);
      if (off2 === offset) break;
      offset = off2;
      ms = guess + offset;
    }
    return ms;
  }

  /** expiry 'YYYY-MM-DD' 当天 00:00（服务器时区）对应的 UTC 毫秒 */
  function expiryMidnightUtc(expiry, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry || '');
    if (!m) return null;
    return zonedToUtc(+m[1], +m[2], +m[3], 0, 0, 0, tz);
  }

  /**
   * 距到期日剩余的“自然日”数。
   * 契约：expiry 当天 00:00 起失效，即可用到前一天的 23:59:59。
   * 例如今天 12-25、expiry 12-31 → 剩 6 天。
   */
  function daysLeft(expiry, tz, nowMs) {
    var mid = expiryMidnightUtc(expiry, tz);
    if (mid == null) return null;
    return Math.ceil((mid - nowMs) / 86400000);
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDate(iso) {
    return fmtDateTime(iso).slice(0, 10);
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtSize(bytes) {
    var n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /** 服务器时区下的“今天”日期字符串 YYYY-MM-DD（导入默认名用） */
  function todayStr(tz, nowMs) {
    tz = tz || 'Asia/Shanghai';
    try {
      var parts = {};
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(nowMs || Date.now())).forEach(function (p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (e) {
      var d = new Date(nowMs || Date.now());
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  }

  window.TimeUtils = {
    zonedToUtc: zonedToUtc,
    expiryMidnightUtc: expiryMidnightUtc,
    daysLeft: daysLeft,
    fmtDateTime: fmtDateTime,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    fmtSize: fmtSize,
    todayStr: todayStr,
  };
})();
