(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});
  var KEY = 'csbp.m1.v2';
  var LEGACY_KEYS = ['csbp.m1.v1', 'csbp.room.v1'];
  var SERIES = [1, 3, 5];
  var PHASES = ['home', 'lobby', 'captains', 'draft', 'order', 'mapbp', 'result'];
  var SIDES = ['A', 'B'];

  function blankPlayers() {
    var arr = [];
    for (var i = 0; i < 10; i += 1) arr.push('');
    return arr;
  }

  function createState() {
    return {
      phase: 'home',
      config: {
        game: '',
        series: 1,
        mode: 'draft',
        rollFirst: false,
        pool: CSBP.Maps.DEFAULT_POOL.slice(),
        poolMode: 'active',
        draftFirst: 'random',
        bpFirst: 'random'
      },
      players: blankPlayers(),
      captains: null,
      roll: null,
      draft: { first: null, picks: [] },
      mapbp: { first: null, steps: [], results: [], sides: {}, pending: null },
      updatedAt: Date.now()
    };
  }

  function isSide(v) {
    return v === 'A' || v === 'B';
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;

    var cfg = raw.config && typeof raw.config === 'object' ? raw.config : {};

    // 先按存档切换游戏，再校验图池；旧存档没有 game 字段时视为 CS2
    var rawGame = typeof cfg.game === 'string' ? cfg.game : 'cs2';
    var game = CSBP.Games.get(rawGame);
    if (game) CSBP.Games.use(game.id);
    var gameId = game ? game.id : '';

    var base = createState();

    var validIds = {};
    CSBP.Maps.MAPS.forEach(function (m) { validIds[m.id] = true; });

    var pool = [];
    if (Array.isArray(cfg.pool)) {
      cfg.pool.forEach(function (id) {
        if (validIds[id] && pool.indexOf(id) === -1) pool.push(id);
      });
    }
    if (!pool.length) pool = CSBP.Maps.DEFAULT_POOL.slice();

    var players = [];
    if (Array.isArray(raw.players)) {
      players = raw.players.slice(0, 10).map(function (v) {
        return typeof v === 'string' ? v.slice(0, 24) : '';
      });
    }
    while (players.length < 10) players.push('');

    var captains = null;
    if (raw.captains &&
        Number.isInteger(raw.captains.A) && Number.isInteger(raw.captains.B) &&
        raw.captains.A >= 0 && raw.captains.A < 10 &&
        raw.captains.B >= 0 && raw.captains.B < 10 &&
        raw.captains.A !== raw.captains.B) {
      captains = { A: raw.captains.A, B: raw.captains.B };
    }

    var draft = { first: null, picks: [] };
    var rd = raw.draft && typeof raw.draft === 'object' ? raw.draft : {};
    if (isSide(rd.first) && Array.isArray(rd.picks)) {
      draft.first = rd.first;
      var seen = {};
      var perSide = { A: 0, B: 0 };
      rd.picks.forEach(function (p) {
        if (draft.picks.length >= CSBP.Draft.TOTAL_PICKS) return;
        if (!p || !Number.isInteger(p.player) || p.player < 0 || p.player > 9) return;
        if (!isSide(p.side) || seen[p.player]) return;
        // 队长不参与选秀
        if (captains && (p.player === captains.A || p.player === captains.B)) return;
        if (perSide[p.side] >= CSBP.Draft.TEAM_PICKS) return;
        seen[p.player] = true;
        perSide[p.side] += 1;
        draft.picks.push({ player: p.player, side: p.side });
      });
    }

    var mapbp = { first: null, steps: [], results: [], sides: {}, pending: null };
    var rm = raw.mapbp && typeof raw.mapbp === 'object' ? raw.mapbp : {};
    if (isSide(rm.first) && Array.isArray(rm.steps) && Array.isArray(rm.results)) {
      mapbp.first = rm.first;
      rm.steps.forEach(function (st) {
        if (!st || (st.type !== 'ban' && st.type !== 'pick') || !isSide(st.side)) return;
        mapbp.steps.push({ type: st.type, side: st.side });
      });
      var usedMap = {};
      var resultOk = true;
      rm.results.slice(0, mapbp.steps.length).forEach(function (r) {
        if (!resultOk) return;
        var step = mapbp.steps[mapbp.results.length];
        if (!r || !validIds[r.mapId] || pool.indexOf(r.mapId) === -1) {
          resultOk = false;
          return;
        }
        if (usedMap[r.mapId]) {
          resultOk = false;
          return;
        }
        if (r.type !== step.type || r.side !== step.side) {
          resultOk = false;
          return;
        }
        usedMap[r.mapId] = true;
        mapbp.results.push({ mapId: r.mapId, type: r.type, side: r.side });
      });

      if (rm.sides && typeof rm.sides === 'object') {
        Object.keys(rm.sides).forEach(function (id) {
          var v = rm.sides[id];
          if (validIds[id] && pool.indexOf(id) >= 0 && (v === 'CT' || v === 'T')) {
            mapbp.sides[id] = v;
          }
        });
      }

      var rp = rm.pending;
      if (rp && typeof rp === 'object' && validIds[rp.mapId] && pool.indexOf(rp.mapId) >= 0 && isSide(rp.side)) {
        var pickedMap = mapbp.results.some(function (r) { return r.mapId === rp.mapId; });
        if ((rp.kind === 'pick' && pickedMap) || (rp.kind === 'decider' && !pickedMap)) {
          mapbp.pending = { mapId: rp.mapId, side: rp.side, kind: rp.kind };
        }
      }
    }

    var roll = null;
    if (raw.roll && typeof raw.roll === 'object') {
      var rollA = Number.isInteger(raw.roll.A) && raw.roll.A >= 1 && raw.roll.A <= 100 ? raw.roll.A : null;
      var rollB = Number.isInteger(raw.roll.B) && raw.roll.B >= 1 && raw.roll.B <= 100 ? raw.roll.B : null;
      if (rollA !== null || rollB !== null) roll = { A: rollA, B: rollB };
    }

    var phase = PHASES.indexOf(raw.phase) >= 0 ? raw.phase : 'home';
    if ((phase === 'draft' || phase === 'order' || phase === 'mapbp' || phase === 'result') &&
        (!captains || !draft.first)) {
      phase = 'lobby';
    }
    if (phase === 'order' && (cfg.rollFirst !== true || !rollDone(roll) || draft.picks.length < CSBP.Draft.TOTAL_PICKS)) {
      phase = 'lobby';
    }
    if ((phase === 'mapbp' || phase === 'result') && !mapbp.steps.length) {
      phase = draft.picks.length >= CSBP.Draft.TOTAL_PICKS ? 'captains' : 'lobby';
    }
    if (phase === 'result' && (mapbp.results.length < mapbp.steps.length || mapbp.pending)) {
      phase = 'mapbp';
    }
    if (phase === 'mapbp' && mapbp.steps.length &&
        mapbp.results.length === mapbp.steps.length && !mapbp.pending) {
      phase = 'result';
    }
    // 选人已完成但仍停在选人页时保持该阶段，由页面上的「进入下一步」继续

    var series = SERIES.indexOf(cfg.series) >= 0 ? cfg.series : 1;

    return {
      phase: phase,
      config: {
        game: gameId,
        series: series,
        mode: cfg.mode === 'random' ? 'random' : 'draft',
        rollFirst: cfg.rollFirst === true,
        pool: pool,
        poolMode: cfg.poolMode === 'all' || cfg.poolMode === 'active'
          ? cfg.poolMode
          : (pool.every(function (id) { return !CSBP.ActiveMaps || CSBP.ActiveMaps.has(id); }) ? 'active' : 'all'),
        draftFirst: ['random'].concat(SIDES).indexOf(cfg.draftFirst) >= 0 ? cfg.draftFirst : 'random',
        bpFirst: ['random'].concat(SIDES).indexOf(cfg.bpFirst) >= 0 ? cfg.bpFirst : 'random'
      },
      players: players.length === 10 ? players : base.players,
      captains: captains,
      draft: draft,
      mapbp: mapbp,
      roll: roll,
      updatedAt: Date.now()
    };
  }

  function load() {
    LEGACY_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    });
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return sanitize(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  var state = load() || createState();
  var listeners = [];

  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* ignore listener errors */ }
    });
  }

  function save() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* ignore quota / private mode */ }
    notify();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  // 访客端接收房主状态：不写入本地存储，也不触发广播
  function applyRemote(raw) {
    var next = sanitize(raw);
    if (!next) return false;
    state = next;
    return true;
  }

  function resolveSide(value) {
    if (value === 'A' || value === 'B') return value;
    return CSBP.Draft.randInt(2) === 0 ? 'A' : 'B';
  }

  function setPhase(phase) {
    if (PHASES.indexOf(phase) >= 0) {
      state.phase = phase;
      save();
    }
  }

  function setSeries(series) {
    if (SERIES.indexOf(series) >= 0) {
      state.config.series = series;
      save();
    }
  }

  // 切换组队方式：会清空已确定的队长与选人结果，避免状态错位
  function setMode(mode) {
    var next = mode === 'random' ? 'random' : 'draft';
    if (state.config.mode === next) return;
    state.config.mode = next;
    resetGames();
    state.phase = 'lobby';
    save();
  }

  // 选择游戏：重置图池与对局进度，回到首页
  function setGame(id) {
    var game = CSBP.Games.get(id);
    if (!game || state.config.game === game.id) return false;
    CSBP.Games.use(game.id);
    state.config.game = game.id;
    state.config.poolMode = 'active';
    state.config.pool = game.active.IDS.slice();
    resetGames();
    state.phase = 'home';
    save();
    return true;
  }

  // 图池视图：现役七图（仅展示现役地图）/ 全部地图
  function setPoolMode(mode) {
    var next = mode === 'all' ? 'all' : 'active';
    var ids = next === 'all'
      ? CSBP.Maps.MAPS.map(function (m) { return m.id; })
      : (CSBP.ActiveMaps ? CSBP.ActiveMaps.IDS.slice() : CSBP.Maps.DEFAULT_POOL.slice());
    state.config.poolMode = next;
    state.config.pool = ids;
    save();
  }

  function setPool(pool) {
    var validIds = {};
    CSBP.Maps.MAPS.forEach(function (m) { validIds[m.id] = true; });
    var next = [];
    (pool || []).forEach(function (id) {
      if (validIds[id] && next.indexOf(id) === -1) next.push(id);
    });
    if (!next.length) return;
    state.config.pool = next;
    save();
  }

  function setFirst(field, value) {
    if (field !== 'draftFirst' && field !== 'bpFirst') return;
    if (['random'].concat(SIDES).indexOf(value) < 0) return;
    state.config[field] = value;
    save();
  }

  function setRollFirst(on) {
    var next = on === true;
    if (state.config.rollFirst === next) return;
    state.config.rollFirst = next;
    if (!next) state.roll = null;
    save();
  }

  // Roll 点是否已完成：双方都已 Roll 且点数不同（平局需重 Roll）
  function rollDone(roll) {
    if (!roll || typeof roll !== 'object') return false;
    if (roll.A === null || roll.A === undefined) return false;
    if (roll.B === null || roll.B === undefined) return false;
    return roll.A !== roll.B;
  }

  function setRoll(a, b) {
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (a < 1 || a > 100 || b < 1 || b > 100 || a === b) return false;
    state.roll = { A: a, B: b };
    save();
    return true;
  }

  // 队长各自 Roll 点：每队只能 Roll 一次
  function setRollSide(side, value) {
    if (side !== 'A' && side !== 'B') return false;
    if (!Number.isInteger(value) || value < 1 || value > 100) return false;
    if (state.config.rollFirst !== true || !state.captains) return false;
    var current = state.roll && typeof state.roll === 'object' ? state.roll : { A: null, B: null };
    if (current[side] !== null && current[side] !== undefined) return false;
    state.roll = { A: current.A === undefined ? null : current.A, B: current.B === undefined ? null : current.B };
    state.roll[side] = value;
    save();
    return true;
  }

  function resetRoll() {
    state.roll = null;
    save();
  }

  // Roll 点开启且已有结果时，点数大的队伍先选人；BAN 顺序由胜者在 BP 前另行选择
  function firstSide(field) {
    if (field === 'draftFirst' && state.config.rollFirst && rollDone(state.roll)) {
      return state.roll.A > state.roll.B ? 'A' : 'B';
    }
    return resolveSide(state.config[field]);
  }

  function setPlayer(index, value) {
    if (index < 0 || index > 9) return;
    state.players[index] = String(value || '').slice(0, 24);
    save();
  }

  function resetGames() {
    state.captains = null;
    state.roll = null;
    state.draft = { first: null, picks: [] };
    state.mapbp = emptyMapBP();
  }

  function emptyMapBP() {
    return { first: null, steps: [], results: [], sides: {}, pending: null };
  }

  function clearCaptainsPhase() {
    resetGames();
    state.phase = 'captains';
    save();
  }

  function setCaptains(a, b) {
    state.captains = { A: a, B: b };
    state.roll = null;
    state.draft = { first: null, picks: [] };
    state.mapbp = emptyMapBP();
    state.phase = 'captains';
    save();
  }

  // 图池校验：所有赛制都必须恰好 7 张
  function poolReady() {
    return state.config.pool.length === 7;
  }

  function startDraft() {
    if (!state.captains) return false;
    if (state.config.rollFirst && !rollDone(state.roll)) return false;
    if (!poolReady()) return false;
    state.draft = { first: firstSide('draftFirst'), picks: [] };
    state.mapbp = emptyMapBP();
    state.phase = 'draft';
    save();
    return true;
  }

  // 随机分组：随机抽取两名队长，其余 8 人随机分成两队（每队队长 + 4 人）
  function randomSplit() {
    if (!poolReady()) return false;
    var pair = CSBP.Draft.randomPair(10);
    var rest = [];
    var i;
    for (i = 0; i < 10; i += 1) {
      if (i !== pair.a && i !== pair.b) rest.push(i);
    }
    for (i = rest.length - 1; i > 0; i -= 1) {
      var k = CSBP.Draft.randInt(i + 1);
      var tmp = rest[i];
      rest[i] = rest[k];
      rest[k] = tmp;
    }

    state.captains = { A: pair.a, B: pair.b };
    state.roll = null;
    state.draft = {
      // 随机分组不经过选人，first 仅作为合法标记位；picks 只记录队长以外的队员
      first: 'A',
      picks: rest.slice(0, 4).map(function (p) { return { player: p, side: 'A' }; })
        .concat(rest.slice(4).map(function (p) { return { player: p, side: 'B' }; }))
    };
    state.mapbp = emptyMapBP();
    state.phase = 'captains';
    save();
    return true;
  }

  // 随机分组后进入地图 BP；开启 Roll 点时先由胜者选择 BAN 顺序
  function startMapBP() {
    if (!state.captains) return false;
    if (state.draft.picks.length < CSBP.Draft.TOTAL_PICKS) return false;
    if (!poolReady()) return false;
    if (state.config.rollFirst && rollDone(state.roll)) {
      state.mapbp = emptyMapBP();
      state.phase = 'order';
      save();
      return true;
    }
    return beginMapBP(resolveSide(state.config.bpFirst));
  }

  function beginMapBP(first) {
    state.mapbp = {
      first: first,
      steps: CSBP.MapBP.stepsFor(state.config.series, state.config.pool.length, first),
      results: [],
      sides: {},
      pending: null
    };
    state.phase = 'mapbp';
    save();
    return true;
  }

  // Roll 点胜者选择先 BAN（first=true）或后 BAN
  function setBanOrder(first) {
    if (state.phase !== 'order') return false;
    if (!state.config.rollFirst || !rollDone(state.roll)) return false;
    var winner = state.roll.A > state.roll.B ? 'A' : 'B';
    return beginMapBP(first === true ? winner : CSBP.Draft.flip(winner));
  }

  // 选人结束：有 Roll 结果先进入 BAN 顺序选择，否则直接开始地图 BP
  function completeDraft() {
    if (state.config.rollFirst && rollDone(state.roll)) {
      state.mapbp = emptyMapBP();
      state.phase = 'order';
    } else {
      var first = resolveSide(state.config.bpFirst);
      state.mapbp = {
        first: first,
        steps: CSBP.MapBP.stepsFor(state.config.series, state.config.pool.length, first),
        results: [],
        sides: {},
        pending: null
      };
      state.phase = 'mapbp';
    }
  }

  function pickPlayer(index) {
    if (!state.captains || state.draft.picks.length >= CSBP.Draft.TOTAL_PICKS) return false;
    if (!Number.isInteger(index) || index < 0 || index > 9) return false;
    // 队长已经固定在自己队伍中，不再进入选秀池
    if (index === state.captains.A || index === state.captains.B) return false;
    var taken = state.draft.picks.some(function (p) { return p.player === index; });
    if (taken) return false;

    var order = CSBP.Draft.order(state.draft.first, CSBP.Draft.TOTAL_PICKS);
    var side = order[state.draft.picks.length];
    state.draft.picks.push({ player: index, side: side });

    if (state.draft.picks.length === CSBP.Draft.TOTAL_PICKS) completeDraft();
    save();
    return true;
  }

  // 选人已全部完成却仍停留在选人页（旧存档 / 页面中断）时，手动推进到下一步
  function finishDraft() {
    if (state.phase !== 'draft' || !state.captains) return false;
    if (state.draft.picks.length < CSBP.Draft.TOTAL_PICKS) return false;
    completeDraft();
    save();
    return true;
  }

  function remainingMap() {
    var used = {};
    state.mapbp.results.forEach(function (r) { used[r.mapId] = true; });
    for (var i = 0; i < state.config.pool.length; i += 1) {
      if (!used[state.config.pool[i]]) return state.config.pool[i];
    }
    return null;
  }

  // 决胜图没有队伍选图，由最后 BAN 方的对手选择起始阵营
  function openDeciderSide() {
    var decider = remainingMap();
    if (!decider) return;
    var lastBan = null;
    state.mapbp.steps.forEach(function (st) {
      if (st.type === 'ban') lastBan = st;
    });
    var chooser = lastBan ? CSBP.Draft.flip(lastBan.side) : 'A';
    state.mapbp.pending = { mapId: decider, side: chooser, kind: 'decider' };
  }

  function bpAct(mapId) {
    var step = state.mapbp.steps[state.mapbp.results.length];
    if (!step) return false;
    if (state.mapbp.pending) return false;
    if (state.config.pool.indexOf(mapId) === -1) return false;
    var used = state.mapbp.results.some(function (r) { return r.mapId === mapId; });
    if (used) return false;

    state.mapbp.results.push({ mapId: mapId, type: step.type, side: step.side });

    if (step.type === 'pick') {
      // 每张被 PICK 的图由对手选边
      state.mapbp.pending = { mapId: mapId, side: CSBP.Draft.flip(step.side), kind: 'pick' };
    } else if (state.mapbp.results.length === state.mapbp.steps.length) {
      openDeciderSide();
    }
    save();
    return true;
  }

  // 选边：pending.side 方选择 CT / T
  function bpSide(value) {
    var pending = state.mapbp.pending;
    if (!pending) return false;
    if (value !== 'CT' && value !== 'T') return false;
    state.mapbp.sides[pending.mapId] = value;
    state.mapbp.pending = null;

    if (pending.kind === 'decider') {
      state.phase = 'result';
    } else if (state.mapbp.results.length === state.mapbp.steps.length) {
      openDeciderSide();
    }
    save();
    return true;
  }

  function newRound() {
    resetGames();
    state.phase = 'lobby';
    save();
  }

  function resetAll() {
    state = createState();
    save();
  }

  CSBP.Store = {
    get state() { return state; },
    save: save,
    subscribe: subscribe,
    snapshot: snapshot,
    applyRemote: applyRemote,
    setPhase: setPhase,
    setSeries: setSeries,
    setMode: setMode,
    setGame: setGame,
    setPool: setPool,
    setPoolMode: setPoolMode,
    setFirst: setFirst,
    setRollFirst: setRollFirst,
    setRoll: setRoll,
    setRollSide: setRollSide,
    resetRoll: resetRoll,
    rollDone: rollDone,
    setPlayer: setPlayer,
    clearCaptainsPhase: clearCaptainsPhase,
    setCaptains: setCaptains,
    startDraft: startDraft,
    randomSplit: randomSplit,
    finishDraft: finishDraft,
    startMapBP: startMapBP,
    setBanOrder: setBanOrder,
    pickPlayer: pickPlayer,
    bpAct: bpAct,
    bpSide: bpSide,
    newRound: newRound,
    resetAll: resetAll
  };
})();
