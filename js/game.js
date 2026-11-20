(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  // 游戏注册表：切换游戏时会替换 CSBP.Maps / CSBP.ActiveMaps，
  // 其余业务代码（选人、地图 BP、战报）无需区分游戏。
  var GAMES = {
    cs2: {
      id: 'cs2',
      label: 'CS2',
      name: 'Counter-Strike 2',
      maps: CSBP.Maps,
      active: CSBP.ActiveMaps
    },
    valorant: {
      id: 'valorant',
      label: 'VALORANT',
      name: '无畏契约',
      maps: CSBP.ValorantMaps,
      active: CSBP.ValorantActive
    }
  };

  var ORDER = ['cs2', 'valorant'];
  var current = GAMES.cs2;

  function get(id) {
    return GAMES[id] || null;
  }

  function use(id) {
    current = GAMES[id] || GAMES.cs2;
    CSBP.Maps = current.maps;
    CSBP.ActiveMaps = current.active;
    CSBP.CurrentGame = current;
    return current;
  }

  function list() {
    return ORDER.map(function (id) { return GAMES[id]; });
  }

  CSBP.Games = {
    get: get,
    use: use,
    list: list,
    current: function () { return current; }
  };

  use('cs2');
})();
