(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  function flip(side) {
    return side === 'A' ? 'B' : 'A';
  }

  var TEAM_PICKS = 4;
  var TOTAL_PICKS = TEAM_PICKS * 2;

  // 蛇形选人顺序：先手 A -> A B B A A B B A（8 手，每队各 4 人，队长不参与选秀）
  function order(first, count) {
    var start = first === 'B' ? 'B' : 'A';
    var pattern = [start, flip(start), flip(start), start];
    var total = typeof count === 'number' ? count : TOTAL_PICKS;
    var out = [];
    for (var i = 0; i < total; i += 1) {
      out.push(pattern[i % 4]);
    }
    return out;
  }

  function randInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      var limit = Math.floor(0x100000000 / max) * max;
      var v;
      do {
        window.crypto.getRandomValues(buf);
        v = buf[0];
      } while (v >= limit);
      return v % max;
    }
    return Math.floor(Math.random() * max);
  }

  // 从 size 名选手中随机抽取两名互不相同的队长
  function randomPair(size) {
    var idx = [];
    for (var i = 0; i < size; i += 1) idx.push(i);
    for (var j = idx.length - 1; j > 0; j -= 1) {
      var k = randInt(j + 1);
      var tmp = idx[j];
      idx[j] = idx[k];
      idx[k] = tmp;
    }
    return { a: idx[0], b: idx[1] };
  }

  CSBP.Draft = {
    order: order,
    flip: flip,
    randomPair: randomPair,
    randInt: randInt,
    TEAM_PICKS: TEAM_PICKS,
    TOTAL_PICKS: TOTAL_PICKS
  };
})();
