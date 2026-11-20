(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  // VALORANT 全部地图（13 张）
  // 数据来源：VALORANT 官方地图页 + 当前竞技图池（2026 年 V26 第六幕 / 13.08 补丁）
  // 需要更新地图时只改这里，id 保持英文小写
  var MAPS = [
    { id: 'ascent', cn: '亚海悬城', en: 'Ascent', hue: 205 },
    { id: 'bind', cn: '源工重镇', en: 'Bind', hue: 28 },
    { id: 'breeze', cn: '微风岛屿', en: 'Breeze', hue: 190 },
    { id: 'fracture', cn: '裂变峡谷', en: 'Fracture', hue: 15 },
    { id: 'haven', cn: '隐世修所', en: 'Haven', hue: 275 },
    { id: 'icebox', cn: '森寒冬港', en: 'Icebox', hue: 195 },
    { id: 'lotus', cn: '莲华古城', en: 'Lotus', hue: 145 },
    { id: 'pearl', cn: '深海明珠', en: 'Pearl', hue: 210 },
    { id: 'split', cn: '霓虹町', en: 'Split', hue: 320 },
    { id: 'sunset', cn: '日落之城', en: 'Sunset', hue: 25 },
    { id: 'abyss', cn: '幽邃地窟', en: 'Abyss', hue: 255 },
    { id: 'corrode', cn: '盐海矿镇', en: 'Corrode', hue: 35 },
    { id: 'summit', cn: '天枢云阙', en: 'Summit', hue: 40 }
  ];

  // 现役七图：2026 年 V26 第六幕竞技图池
  // Haven / Corrode / Bind / Sunset / Abyss / Lotus / Summit
  var ACTIVE_IDS = ['haven', 'corrode', 'bind', 'sunset', 'abyss', 'lotus', 'summit'];

  var MAP_BY_ID = {};
  MAPS.forEach(function (m) {
    MAP_BY_ID[m.id] = m;
  });

  function get(id) {
    return MAP_BY_ID[id] || { id: id, cn: id, en: id, hue: 200 };
  }

  CSBP.ValorantMaps = {
    MAPS: MAPS,
    DEFAULT_POOL: ACTIVE_IDS.slice(),
    get: get
  };

  CSBP.ValorantActive = {
    IDS: ACTIVE_IDS,
    has: function (id) { return ACTIVE_IDS.indexOf(id) >= 0; },
    list: function () {
      return ACTIVE_IDS.map(function (id) { return get(id); });
    }
  };
})();
