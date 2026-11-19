/* ============================================================================
 * 站点配置文件
 * ----------------------------------------------------------------------------
 * 只修改本文件即可更换页面文案与 GitHub 入口，无需改动其他代码。
 *
 * brandMark    左上角徽标文字（1~2 个字符效果最好；配置 brandLogo 后不再显示文字）
 * brandLogo    左上角徽标图片地址，支持相对路径（如 assets/logo.png）或网络图片；
 *              留空 '' 则使用 brandMark 文字徽标
 * brandText    徽标右侧的品牌名
 * heroTitle1   首页大标题第一行（支持 HTML，可用 <span class="grad"> 高亮部分文字）
 * heroTitle2   首页大标题第二行
 * githubUrl    GitHub 链接地址；留空字符串 '' 则不显示 GitHub 入口
 * githubLabel  GitHub 入口显示的文字
 * ========================================================================== */
(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  CSBP.SiteConfig = {
    brandMark: 'CS',
    // 示例：brandLogo: 'assets/logo.png'
    brandLogo: '',
    brandText: 'CS2 BanPick工具',

    heroTitle1: '在线 <span class="grad">BanPick</span>',
    heroTitle2: '让BanPick更便捷。',

    // 改成你的仓库地址，例如 https://github.com/yourname/csbp-online
    githubUrl: 'https://github.com/GGHePinGG/CS-BanPick-TOOL',
    githubLabel: 'GitHub'
  };
})();
