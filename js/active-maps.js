(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  // CS2 现役图池（Active Duty）
  // 需要更新现役地图时只改这里：数组顺序即展示顺序，id 必须与 js/maps.js 中的 id 一致
  var CS2_ACTIVE_IDS = ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'cache'];

  // VALORANT 现役七图：2026 年 V26 第六幕 / 13.08 补丁竞技图池
  // Haven / Corrode / Bind / Sunset / Abyss / Lotus / Summit
  // id 必须与 js/valorant-maps.js 中的 id 一致
  var VALORANT_ACTIVE_IDS = ['haven', 'corrode', 'bind', 'sunset', 'abyss', 'lotus', 'summit'];

  // 两个游戏共用同一套现役图池接口，source 延迟取得当前游戏的全部地图
  function createActive(ids, source) {
    return {
      IDS: ids,
      has: function (id) {
        return ids.indexOf(id) >= 0;
      },
      list: function () {
        var maps = source();
        if (!maps) return [];
        return ids.map(function (id) { return maps.get(id); });
      }
    };
  }

  CSBP.ActiveMaps = createActive(CS2_ACTIVE_IDS, function () { return CSBP.Maps; });
  CSBP.ValorantActive = createActive(VALORANT_ACTIVE_IDS, function () { return CSBP.ValorantMaps; });
})();
