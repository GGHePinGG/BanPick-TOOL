/* ============================================================================
 * 语言状态与静态文案
 * ----------------------------------------------------------------------------
 * 默认简体中文（zh-CN），可切换为英文（en-US），选择保存在 localStorage。
 * 视图文案在 app.js 中通过 CSBP.I18n.L('中文', 'English') 取当前语言。
 * ========================================================================== */
(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});
  var KEY = 'csbp.lang.v1';
  var lang = 'zh';

  try {
    var saved = window.localStorage.getItem(KEY);
    if (saved === 'zh' || saved === 'en') lang = saved;
  } catch (e) { /* ignore */ }

  var STATIC = {
    en: {
      resetAll: 'Reset',
      backHome: 'Back to home',
      toggleTheme: 'Toggle light / dark theme',
      openGithub: 'Open the GitHub repository',
      language: 'Language',
      noscript: 'This tool requires JavaScript to run.'
    },
    zh: {
      resetAll: '清空重开',
      backHome: '回到首页',
      toggleTheme: '切换白天 / 夜晚模式',
      openGithub: '打开 GitHub 仓库',
      language: '切换语言',
      noscript: '本工具需要启用 JavaScript 才能运行。'
    }
  };

  function isZh() {
    return lang === 'zh';
  }

  // 行内取词：zh 为中文，en 为英文
  function L(zh, en) {
    return lang === 'zh' ? zh : en;
  }

  function t(key) {
    var table = STATIC[lang] || STATIC.en;
    return table[key] !== undefined ? table[key] : key;
  }

  // 把静态 HTML 上的文案与 aria 标签切到当前语言
  function applyStatic() {
    var html = document.documentElement;
    html.setAttribute('data-lang', lang);
    html.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en-US');

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });

    var brand = document.querySelector('[data-action="go-home"]');
    if (brand) brand.setAttribute('aria-label', t('backHome'));
    var theme = document.getElementById('themeToggle');
    if (theme) theme.setAttribute('aria-label', t('toggleTheme'));
    var github = document.getElementById('githubLink');
    if (github) github.setAttribute('aria-label', t('openGithub'));
    var group = document.querySelector('.lang-switch');
    if (group) group.setAttribute('aria-label', t('language'));

    Array.prototype.forEach.call(document.querySelectorAll('[data-action="set-lang"]'), function (btn) {
      var on = btn.getAttribute('data-lang') === lang;
      if (on) btn.classList.add('active');
      else btn.classList.remove('active');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setLang(next) {
    var value = next === 'zh' ? 'zh' : 'en';
    if (value === lang) return false;
    lang = value;
    try { window.localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    applyStatic();
    return true;
  }

  CSBP.I18n = {
    get lang() { return lang; },
    isZh: isZh,
    L: L,
    t: t,
    setLang: setLang,
    applyStatic: applyStatic
  };
})();
