/* iOS 安装引导（契约 33）：判断是否应显示「添加到主屏幕」提示条。
 * iPhone/iPad Safari、非独立模式（navigator.standalone !== true）、
 * 且 localStorage 未记录关闭（键 pc_ios_hint_dismissed）时才显示。
 * 纯函数模块，便于无浏览器环境测试。 */
(function () {
  'use strict';

  function shouldShow(ua, standalone, dismissed) {
    var isIos = /iPhone|iPad|iPod/.test(ua || '');
    if (!isIos) return false;
    if (standalone === true) return false;
    if (dismissed) return false;
    return true;
  }

  window.IosHint = { shouldShow: shouldShow };
})();
