(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  function flip(side) {
    return side === 'A' ? 'B' : 'A';
  }

  /**
   * 生成地图 BP 步骤。
   * BO1：AABBBAD —— 先手方 BAN 2 张、对手 BAN 3 张、先手方再 BAN 1 张，
   *      剩余 1 张为比赛地图（图池需恰好 7 张）。
   * BO3：ban, ban, pick, pick, ban × (图池 - 5)，最后 1 张为决胜图。
   * BO5：ban × (图池 - 5), pick × 4，最后 1 张为决胜图。
   * first 为 BAN/BAN-PICK 序列的第一支队伍。
   */
  function stepsFor(series, poolSize, first) {
    var start = first === 'B' ? 'B' : 'A';
    var other = flip(start);
    var size = Math.max(1, Number(poolSize) || 1);
    var i;

    if (series === 1) {
      var pattern = [start, start, other, other, other, start];
      var bans = [];
      for (i = 0; i < size - 1; i += 1) {
        bans.push({ type: 'ban', side: pattern[i % pattern.length] });
      }
      return bans;
    }

    var types = [];
    if (series === 3) {
      types.push('ban', 'ban', 'pick', 'pick');
      for (i = 0; i < size - 5; i += 1) types.push('ban');
    } else {
      for (i = 0; i < size - 5; i += 1) types.push('ban');
      for (i = 0; i < 4; i += 1) types.push('pick');
    }

    var side = start;
    return types.map(function (type) {
      var step = { type: type, side: side };
      side = flip(side);
      return step;
    });
  }

  /**
   * 根据已完成的 BP 结果推导最终比赛地图顺序。
   * pick 按操作顺序排列，最后剩余的一张为决胜图（BO1 即唯一比赛地图）。
   */
  function decidedMaps(state) {
    var used = {};
    state.mapbp.results.forEach(function (r) {
      used[r.mapId] = true;
    });

    var decider = null;
    for (var i = 0; i < state.config.pool.length; i += 1) {
      if (!used[state.config.pool[i]]) {
        decider = state.config.pool[i];
        break;
      }
    }

    var out = state.mapbp.results
      .filter(function (r) { return r.type === 'pick'; })
      .map(function (r) {
        return { mapId: r.mapId, side: r.side, type: 'pick' };
      });

    if (decider) {
      out.push({ mapId: decider, side: null, type: 'decider' });
    }
    return out;
  }

  CSBP.MapBP = {
    stepsFor: stepsFor,
    decidedMaps: decidedMaps
  };
})();
