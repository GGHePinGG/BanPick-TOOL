(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  // CS2 现役图池（Active Duty）
  // 需要更新现役地图时只改这里：数组顺序即展示顺序，id 必须与 js/maps.js 中的 id 一致
  var ACTIVE_IDS = ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'cache'];

  CSBP.ActiveMaps = {
    IDS: ACTIVE_IDS,
    has: function (id) {
      return ACTIVE_IDS.indexOf(id) >= 0;
    },
    list: function () {
      if (!CSBP.Maps) return [];
      return ACTIVE_IDS.map(function (id) { return CSBP.Maps.get(id); });
    }
  };
})();
