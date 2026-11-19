(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  // hue 用于生成 CSS 渐变缩略图，避免依赖外部图片资源
  var MAPS = [
    { id: 'ancient', cn: '远古遗迹', en: 'Ancient', hue: 28 },
    { id: 'anubis', cn: '阿努比斯', en: 'Anubis', hue: 45 },
    { id: 'dust2', cn: '炙热沙城 II', en: 'Dust II', hue: 34 },
    { id: 'inferno', cn: '炼狱小镇', en: 'Inferno', hue: 12 },
    { id: 'mirage', cn: '荒漠迷城', en: 'Mirage', hue: 42 },
    { id: 'nuke', cn: '核子危机', en: 'Nuke', hue: 140 },
    { id: 'overpass', cn: '死亡游乐园', en: 'Overpass', hue: 190 },
    { id: 'train', cn: '列车停放站', en: 'Train', hue: 210 },
    { id: 'vertigo', cn: '殒命大厦', en: 'Vertigo', hue: 220 },
    { id: 'cache', cn: '死城之谜', en: 'Cache', hue: 90 },
    { id: 'tuscan', cn: '托斯卡纳', en: 'Tuscan', hue: 30 },
    { id: 'cbble', cn: '古堡激战', en: 'Cobblestone', hue: 260 },
    { id: 'stronghold', cn: '钢铁要塞', en: 'Stronghold', hue: 205 },
    { id: 'sanctum', cn: '圣堂', en: 'Sanctum', hue: 285 },
    { id: 'poseidon', cn: '波塞冬', en: 'Poseidon', hue: 200 },
    { id: 'alpine', cn: '阿尔卑斯', en: 'Alpine', hue: 160 },
    { id: 'office', cn: '办公室', en: 'Office', hue: 35 },
    { id: 'italy', cn: '意大利小镇', en: 'Italy', hue: 20 },
    { id: 'baggage', cn: '行李仓库', en: 'Baggage', hue: 45 },
    { id: 'pool_day', cn: '泳池派对', en: 'Pool Day', hue: 195 },
    { id: 'shoots', cn: '山林小寨', en: 'Shoots', hue: 100 }
  ];

  var DEFAULT_POOL = CSBP.ActiveMaps
    ? CSBP.ActiveMaps.IDS.slice()
    : ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'cache'];

  var MAP_BY_ID = {};
  MAPS.forEach(function (m) {
    MAP_BY_ID[m.id] = m;
  });

  function get(id) {
    return MAP_BY_ID[id] || { id: id, cn: id, en: id, hue: 200 };
  }

  CSBP.Maps = {
    MAPS: MAPS,
    DEFAULT_POOL: DEFAULT_POOL,
    get: get
  };
})();
