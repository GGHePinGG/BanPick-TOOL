/* ============================================================================
 * 站点配置文件 / Site configuration
 * ----------------------------------------------------------------------------
 * 只修改本文件即可更换页面文案与 GitHub 入口，无需改动其他代码。
 * Edit this file to change page copy and the GitHub link. No other code needed.
 *
 * brandMark        左上角徽标文字（1~2 个字符效果最好；配置 brandLogo 后不再显示文字）
 * brandLogo        左上角 Logo 图片地址，直接粘贴图床直链即可，例如：
 *                  brandLogo: 'https://img.example.com/csbp-logo.png'
 *                  也支持相对路径（如 assets/logo.png）；留空 '' 则使用 brandMark 文字徽标
 * brandText        徽标右侧的品牌名（中文）
 * brandTextEn      徽标右侧的品牌名（英文）
 * pageTitles       浏览器标签页标题（中文），随所选游戏切换
 * pageTitlesEn     浏览器标签页标题（英文），随所选游戏切换
 * heroTitle1       首页大标题第一行（中文，支持 HTML）
 * heroTitle1En     首页大标题第一行（英文，支持 HTML）
 * heroTitles       各游戏首页标题（中文），覆盖 heroTitle1 / heroTitle2
 * heroTitlesEn     各游戏首页标题（英文），覆盖 heroTitle1En / heroTitle2En
 * heroTitleNone    尚未选择游戏时的首页标题（中文）
 * heroTitleNoneEn  尚未选择游戏时的首页标题（英文）
 * githubUrl        GitHub 链接地址；留空字符串 '' 则不显示 GitHub 入口
 * githubLabel      GitHub 入口显示的文字
 * ========================================================================== */
(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  CSBP.SiteConfig = {
    brandMark: 'BP',
    // 图床直链示例：brandLogo: 'https://img.example.com/csbp-logo.png'
    brandLogo: '',
    brandText: 'BanPick 工具',
    brandTextEn: 'BanPick Tool',

    // 浏览器标签页标题，随游戏切换；留空使用默认值
    pageTitles: {
      none: 'CS2/Valorant BanPick TOOL',
      cs2: 'CS2 BanPick TOOL',
      valorant: 'VALORANT BanPick TOOL'
    },
    pageTitlesEn: {
      none: 'CS2/Valorant BanPick TOOL',
      cs2: 'CS2 BanPick TOOL',
      valorant: 'VALORANT BanPick TOOL'
    },

    heroTitle1: '在线 <span class="grad">CS2 BanPick</span>',
    heroTitle2: '让BanPick更便捷。',
    heroTitle1En: 'Online <span class="grad">CS2 BanPick</span>',
    heroTitle2En: 'Make BanPick Easier.',

    // 各游戏首页标题；不配置时使用 heroTitle1 / heroTitle2
    heroTitles: {
      cs2: ['在线 <span class="grad">CS2 BanPick</span>', '让BanPick更便捷。'],
      valorant: ['在线 <span class="grad">VALORANT BanPick</span>', '让BanPick更便捷。']
    },
    heroTitlesEn: {
      cs2: ['Online <span class="grad">CS2 BanPick</span>', 'BanPick made simple.'],
      valorant: ['Online <span class="grad">VALORANT BanPick</span>', 'BanPick made simple.']
    },
    // 尚未选择游戏时展示
    heroTitleNone: ['在线 <span class="grad">BanPick</span>', 'CS2 · VALORANT'],
    heroTitleNoneEn: ['Online <span class="grad">BanPick</span>', 'CS2 · VALORANT'],

    // 改成你的仓库地址，例如 https://github.com/yourname/csbp-online
    githubUrl: 'https://github.com/GGHePinGG/BanPick-TOOL',
    githubLabel: 'GitHub'
  };
})();
