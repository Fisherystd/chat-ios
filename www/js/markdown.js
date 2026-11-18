/* Markdown 渲染：marked 解析 + DOMPurify 消毒。
 * v-sanitize 指令：渲染消毒后的 HTML（仅此一处使用 v-html 效果），
 * 并给代码块加“复制”按钮；流式场景按帧节流重渲染。
 */
(function () {
  'use strict';

  // marked v12：use() 配置
  if (window.marked) {
    try {
      marked.use({ gfm: true, breaks: true });
    } catch (e) { /* ignore */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 原始 markdown → 消毒后的 HTML */
  function render(raw) {
    if (raw == null) return '';
    var html;
    try {
      html = marked.parse(String(raw));
    } catch (e) {
      html = '<p>' + escapeHtml(raw) + '</p>';
    }
    if (window.DOMPurify) {
      return DOMPurify.sanitize(html);
    }
    return html;
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /** 给元素内所有 pre 加复制按钮（幂等） */
  function enhance(el) {
    if (!el || !el.querySelectorAll) return;
    el.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.code-copy')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = '复制';
      btn.addEventListener('click', function () {
        var codeEl = pre.querySelector('code');
        var code = codeEl ? codeEl.innerText : pre.innerText;
        function done() {
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1600);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code); done(); });
        } else {
          fallbackCopy(code);
          done();
        }
      });
      pre.appendChild(btn);
    });
  }

  /** 注册 v-sanitize 指令（在 app.mount 前调用） */
  function registerDirective(app) {
    app.directive('sanitize', {
      mounted: function (el, binding) { apply(el, binding.value); },
      updated: function (el, binding) {
        if (binding.value !== binding.oldValue) apply(el, binding.value);
      },
      unmounted: function (el) {
        if (el._raf) { cancelAnimationFrame(el._raf); el._raf = 0; }
      },
    });

    function apply(el, raw) {
      el._raw = raw;
      if (el._raf) return; // 已排帧：等待合帧渲染最新内容
      el._raf = requestAnimationFrame(function () {
        el._raf = 0;
        var html = render(el._raw);
        if (el._lastHtml !== html) {
          el._lastHtml = html;
          el.innerHTML = html;
          enhance(el);
        }
      });
    }
  }

  window.MarkdownUtils = {
    render: render,
    escapeHtml: escapeHtml,
    enhance: enhance,
    registerDirective: registerDirective,
  };
})();
