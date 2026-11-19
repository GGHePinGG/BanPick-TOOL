(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  function playerName(state, idx) {
    if (idx === null || idx === undefined) return '—';
    return state.players[idx] || '选手 ' + (idx + 1);
  }

  function buildReport(state) {
    var lines = [];
    var capA = state.captains ? playerName(state, state.captains.A) : '未知';
    var capB = state.captains ? playerName(state, state.captains.B) : '未知';

    lines.push('CS2 在线 BP 战报');
    lines.push('赛制：BO' + state.config.series + ' ｜ 图池：' + state.config.pool.length + ' 张');
    lines.push('--------------------------------');

    ['A', 'B'].forEach(function (side) {
      var cap = side === 'A' ? capA : capB;
      var names = state.draft.picks
        .filter(function (p) { return p.side === side; })
        .map(function (p) { return playerName(state, p.player); });
      lines.push('队伍 ' + side + '（队长：' + cap + '）');
      lines.push('  ' + (names.length ? names.join(' · ') : '—'));
    });

    lines.push('--------------------------------');
    lines.push('比赛地图');

    CSBP.MapBP.decidedMaps(state).forEach(function (item, i) {
      var map = CSBP.Maps.get(item.mapId);
      var tag;
      if (item.type === 'decider') {
        tag = state.config.series === 1 ? '比赛地图' : '决胜图';
      } else {
        tag = item.side + ' 队选';
      }
      var side = state.mapbp.sides[item.mapId];
      if (side) tag += ' · 选边 ' + side;
      lines.push((i + 1) + '. ' + map.cn + ' ' + map.en + '（' + tag + '）');
    });

    lines.push('--------------------------------');
    lines.push('由 球球 生成');
    return lines.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  CSBP.Share = {
    buildReport: buildReport,
    copy: copyText
  };
})();
