(function () {
  'use strict';

  var CSBP = window.CSBP;
  var Store = CSBP.Store;
  var Net = CSBP.Net;
  var app = document.getElementById('app');
  var toastHost = document.getElementById('toast');

  var STEP_DEFS = [
    { key: 'lobby', label: '房间配置' },
    { key: 'captains', label: '确定队长' },
    { key: 'draft', label: '队长选人' },
    { key: 'order', label: 'BAN 顺序' },
    { key: 'mapbp', label: '地图 BP' },
    { key: 'result', label: 'BP 结果' }
  ];

  var rolling = false;
  var rollToken = 0;
  var lastPhase = null;
  var creatingRoom = false;
  var joiningRoom = false;
  var joinOpen = false;
  var joinCodeValue = '';
  var guestRollTicker = null;
  var guestRollTimer = null;
  var autoNextTimer = null;
  var autoNextKey = null;
  var disconnected = false;
  var manualOpen = false;
  var manualA = -1;
  var manualB = -1;
  var rollAnimating = false;
  var rollAnimToken = 0;

  var THEME_KEY = 'csbp.theme.v1';

  // 站点文案 / 链接统一来自 js/site-config.js，这里只是兜底默认值
  var SITE = Object.assign({
    brandMark: 'CS',
    brandLogo: '',
    brandText: 'BP ARENA',
    heroTitle1: '在线 <span class="grad">BP</span>',
    heroTitle2: '队长选人 · 地图博弈',
    pageTitles: {},
    githubUrl: '',
    githubLabel: 'GitHub'
  }, CSBP.SiteConfig || {});

  // 浏览器标题随所选游戏切换
  function applyTitle(gameId) {
    var game = gameId ? CSBP.Games.get(gameId) : null;
    var titles = SITE.pageTitles || {};
    document.title = titles[game ? game.id : 'none'] ||
      (game ? game.label + ' BanPick TOOL' : 'CS2/Valorant BanPick TOOL');
  }

  function applySiteConfig() {
    var mark = document.querySelector('[data-site="brand-mark"]');
    if (mark) {
      var logo = String(SITE.brandLogo || '').trim();
      if (logo) {
        var img = document.createElement('img');
        img.className = 'brand-logo';
        img.src = logo;
        img.alt = SITE.brandText || 'Logo';
        mark.textContent = '';
        mark.appendChild(img);
        mark.classList.add('has-logo');
      } else {
        mark.textContent = SITE.brandMark;
        mark.classList.remove('has-logo');
      }
    }
    var brand = document.querySelector('[data-site="brand-text"]');
    if (brand) brand.textContent = SITE.brandText;

    var github = document.getElementById('githubLink');
    if (github) {
      var url = String(SITE.githubUrl || '').trim();
      github.hidden = !url;
      if (url) {
        github.href = url;
        var label = github.querySelector('span');
        if (label) label.textContent = SITE.githubLabel || 'GitHub';
      }
    }
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }

    var toggle = document.getElementById('themeToggle');
    if (toggle) toggle.setAttribute('aria-pressed', next === 'light' ? 'true' : 'false');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#eef2f8' : '#070a0f');
  }

  function initTheme() {
    var saved = null;
    try { saved = window.localStorage.getItem(THEME_KEY); } catch (e) { saved = null; }
    // 默认白天模式，用户手动切换后记住选择
    applyTheme(saved === 'dark' ? 'dark' : 'light');
  }

  function isGuest() {
    return Net.info().mode === 'guest';
  }

  function isOnline() {
    var mode = Net.info().mode;
    return mode === 'host' || mode === 'guest';
  }

  // 当前轮到哪支队伍操作
  function actingSide(s) {
    if (s.phase === 'draft' && s.draft.first) {
      var order = CSBP.Draft.order(s.draft.first, CSBP.Draft.TOTAL_PICKS);
      return order[s.draft.picks.length] || null;
    }
    if (s.phase === 'mapbp') {
      var step = s.mapbp.steps[s.mapbp.results.length];
      return step ? step.side : null;
    }
    return null;
  }

  // 访客身份：A/B 队长或 null（观战）
  function guestSide() {
    return Net.info().mode === 'guest' ? Net.info().side : null;
  }

  function rollDone(roll) {
    return Store.rollDone(roll);
  }

  function rollWinner(s) {
    if (!rollDone(s.roll)) return null;
    return s.roll.A > s.roll.B ? 'A' : 'B';
  }

  // 图池开局校验：BO1 需恰好 7 张，其余赛制至少 7 张
  function poolProblem(s) {
    if (s.config.series === 1 && s.config.pool.length !== 7) return 'BO1 需要恰好 7 张地图才能开始';
    if (s.config.pool.length < 7) return '图池至少需要 7 张地图才能开始';
    return '';
  }

  function stepDefsFor(config) {
    return STEP_DEFS.filter(function (st) {
      if (config.mode === 'random' && st.key === 'draft') return false;
      if (!config.rollFirst && st.key === 'order') return false;
      return true;
    });
  }

  function roomPill() {
    var info = Net.info();
    if (info.mode === 'local') return '';
    var stateText = disconnected
      ? '连接已断开'
      : (info.localOnly
        ? (info.connected ? '本机联机' : '等待本机标签加入')
        : (info.connected ? '已连接' : (info.mode === 'host' ? '等待加入' : '连接中')));
    var role = info.mode === 'guest' ? (info.side ? info.side + ' 队长' : '观战') + ' · ' : '';
    return '<span class="head-meta online-pill' + (disconnected ? ' is-offline' : '') +
      '"><span class="online-dot"></span>房间 ' + esc(info.code) + ' · ' + role + stateText + '</span>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function playerName(s, idx) {
    if (idx === null || idx === undefined) return '—';
    return s.players[idx] || '选手 ' + (idx + 1);
  }

  function capName(s, side) {
    if (!s.captains || s.captains[side] === undefined) return '—';
    return playerName(s, s.captains[side]);
  }

  function sideToggle(field, value, disabled) {
    var options = [['random', '随机'], ['A', 'A 队'], ['B', 'B 队']];
    return '<div class="segmented mini">' + options.map(function (opt) {
      return '<button class="seg ' + (value === opt[0] ? 'active' : '') +
        '" data-action="set-first" data-field="' + field + '" data-value="' + opt[0] + '"' +
        (disabled ? ' disabled' : '') + '>' +
        opt[1] + '</button>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* 视图                                                                */
  /* ------------------------------------------------------------------ */

  function joinPanel() {
    return `
      <div class="join-panel">
        <div class="join-head"><b>加入房间</b></div>
        <div class="join-row">
          <input id="joinCode" class="join-input" maxlength="5" placeholder="ABCDE" value="${esc(joinCodeValue)}"
            autocomplete="off" spellcheck="false" ${joiningRoom ? 'disabled' : ''} />
          <button class="btn primary" data-action="join-online" ${joiningRoom ? 'disabled' : ''}>${joiningRoom ? '连接中…' : '加入'}</button>
          <button class="btn ghost sm" data-action="hide-join" ${joiningRoom ? 'disabled' : ''}>取消</button>
        </div>
      </div>`;
  }

  function gamePicker() {
    var currentGame = Store.state.config.game;
    return CSBP.Games.list().map(function (g) {
      var on = currentGame === g.id;
      return '<button class="game-card' + (on ? ' on' : '') + '" type="button" data-action="select-game" data-game="' + g.id +
        '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="gc-mark">' + esc(g.label) + '</span>' +
        '<span class="gc-name">' + esc(g.name) + '</span>' +
        '<span class="gc-check" aria-hidden="true">✓</span>' +
        '</button>';
    }).join('');
  }

  function viewHome() {
    var supported = Net.supported();
    var game = CSBP.Games.get(Store.state.config.game);
    var titles = (game && SITE.heroTitles && SITE.heroTitles[game.id]) ||
      (game ? [SITE.heroTitle1, SITE.heroTitle2] : (SITE.heroTitleNone || ['在线 <span class="grad">BanPick</span>', '选择游戏开始']));
    return `
    <section class="view home-view">
      <div class="hero">
        <h1>${titles[0]}<br />${titles[1]}</h1>
        <div class="game-picker" role="group" aria-label="选择游戏">${gamePicker()}</div>
        ${game ? `
        <div class="hero-actions">
          <button class="btn primary lg" data-action="create-online" ${creatingRoom || !supported ? 'disabled' : ''}>${creatingRoom ? '创建中…' : '创建在线房间'} <span class="arrow">→</span></button>
          <button class="btn ghost lg" data-action="show-join" ${joiningRoom || !supported ? 'disabled' : ''}>加入房间</button>
          <button class="btn link lg" data-action="enter-lobby">单机模式</button>
        </div>
        ${!supported ? '<p class="hint warn-text">联机组件加载失败，请刷新页面或检查网络；单机模式仍可正常使用。</p>' : ''}
        ${joinOpen ? joinPanel() : ''}` : ''}
      </div>
    </section>`;
  }

  function roomBar() {
    var info = Net.info();
    if (info.mode === 'local') return '';
    var host = info.mode === 'host';
    var statusText = disconnected
      ? '连接已断开，仅可查看'
      : (info.localOnly
        ? (info.connected ? '本机联机 · 仅同一浏览器标签' : '等待同一浏览器的队长标签加入…')
        : (info.connected ? '已连接' : (host ? '等待队长加入…' : '正在同步房间…')));

    var sideChips = '';
    if (host) {
      sideChips = '<div class="rb-sides">' + ['A', 'B'].map(function (side) {
        var linked = info.sides[side];
        return '<span class="rb-side side-' + side.toLowerCase() + (linked ? ' on' : '') + '">' +
          '<i></i>TEAM ' + side + (linked ? ' 已连接' : ' 等待') + '</span>';
      }).join('') + '</div>';
    } else {
      sideChips = '<span class="rb-role">' + (info.side ? info.side + ' 队长' : '观战模式') + '</span>';
    }

    var copyBtns = host && Store.state.captains
      ? '<button class="btn tiny" data-action="copy-captain-link" data-side="A">复制 A 链接</button>' +
        '<button class="btn tiny" data-action="copy-captain-link" data-side="B">复制 B 链接</button>'
      : '';

    return `
      <div class="room-bar ${info.connected ? 'is-connected' : ''}${disconnected ? ' is-offline' : ''}">
        <div class="rb-left">
          <span class="rb-label">房间码</span>
          <b class="rb-code">${esc(info.code)}</b>
          ${sideChips}
        </div>
        <div class="rb-status"><i></i>${statusText}</div>
        ${copyBtns}
        <button class="btn tiny ghost" data-action="leave-room">${host ? '关闭房间' : '离开房间'}</button>
      </div>`;
  }

  function manualPanel(s) {
    function options(selected) {
      var html = '<option value="-1">请选择选手</option>';
      s.players.forEach(function (p, i) {
        html += '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' +
          (i + 1) + '. ' + esc(p || '空位') + '</option>';
      });
      return html;
    }
    return `
      <div class="manual-panel">
        <div class="panel-head">
          <h3>手动指定队长</h3>
        </div>
        <div class="manual-row">
          <label class="manual-field side-a">
            <span class="team-tag">TEAM A</span>
            <select data-manual-side="A">${options(manualA)}</select>
          </label>
          <label class="manual-field side-b">
            <span class="team-tag">TEAM B</span>
            <select data-manual-side="B">${options(manualB)}</select>
          </label>
        </div>
        <div class="manual-actions">
          <button class="btn primary sm" data-action="confirm-manual-captains">确认队长</button>
          <button class="btn ghost sm" data-action="toggle-manual">取消</button>
        </div>
      </div>`;
  }

  function viewLobby(s) {
    var count = s.config.pool.length;
    var guest = isGuest();
    var randomMode = s.config.mode === 'random';
    return `
    <section class="view">
      <div class="view-head">
        <div><h2>房间配置</h2></div>
        <div class="head-actions">
          <span class="head-meta">${esc(CSBP.CurrentGame.label)}</span>
          <button class="btn ghost sm" data-action="go-home">返回首页</button>
        </div>
      </div>
      ${roomBar()}
      <div class="lobby-grid">
        <div class="panel">
          <div class="panel-head"><h3>赛制</h3></div>
          <div class="segmented">
            ${[1, 3, 5].map(function (n) {
              return '<button class="seg ' + (s.config.series === n ? 'active' : '') +
                '" data-action="set-series" data-series="' + n + '"' + (guest ? ' disabled' : '') + '>BO' + n + '</button>';
            }).join('')}
          </div>

          <div class="panel-head spaced">
            <h3>组队方式</h3>
          </div>
          <div class="segmented">
            <button class="seg ${randomMode ? '' : 'active'}" data-action="set-mode" data-mode="draft"${guest ? ' disabled' : ''}>队长选人</button>
            <button class="seg ${randomMode ? 'active' : ''}" data-action="set-mode" data-mode="random"${guest ? ' disabled' : ''}>随机分组</button>
          </div>

          <div class="panel-head spaced">
            <h3>地图池</h3>
            <span class="count ${count < 7 || (s.config.series === 1 && count !== 7) ? 'warn' : ''}">${count} 张</span>
          </div>
          <div class="pool-tools">
            <button class="btn tiny${s.config.poolMode === 'active' ? ' primary' : ''}" data-action="preset-pool" data-preset="active" ${guest ? 'disabled' : ''}>现役七图</button>
            <button class="btn tiny${s.config.poolMode === 'all' ? ' primary' : ''}" data-action="preset-pool" data-preset="all" ${guest ? 'disabled' : ''}>全部地图</button>
          </div>
          <div class="map-select-grid">
            ${(s.config.poolMode === 'all' ? CSBP.Maps.MAPS : CSBP.ActiveMaps.list()).map(function (m) {
              var on = s.config.pool.indexOf(m.id) >= 0;
              return '<button class="map-tile ' + (on ? 'on' : '') + '" data-action="toggle-map" data-map="' + m.id +
                '" style="--h:' + m.hue + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
                (guest ? ' disabled' : '') + '>' +
                '<span class="mt-cn">' + esc(m.cn) + '</span>' +
                '<span class="mt-en">' + esc(m.en) + '</span>' +
                '<span class="mt-check">✓</span>' +
                '</button>';
            }).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>选手名单</h3></div>
          <div class="player-inputs">
            ${s.players.map(function (p, i) {
              return '<label class="player-input' + (guest ? ' is-readonly' : '') + '">' +
                '<span class="pi-no">' + String(i + 1).padStart(2, '0') + '</span>' +
                '<input data-player="' + i + '" value="' + esc(p) + '" maxlength="24" placeholder="选手 ID / 昵称" ' +
                'autocomplete="off" spellcheck="false"' + (guest ? ' readonly' : '') + ' />' +
                '</label>';
            }).join('')}
          </div>

          <div class="panel-head spaced"><h3>先手设置</h3></div>
          <div class="setting-row"><span>Roll 点定先手</span>
            <div class="segmented mini">
              <button class="seg ${s.config.rollFirst ? '' : 'active'}" data-action="set-roll-first" data-value="off"${guest ? ' disabled' : ''}>关闭</button>
              <button class="seg ${s.config.rollFirst ? 'active' : ''}" data-action="set-roll-first" data-value="on"${guest ? ' disabled' : ''}>开启</button>
            </div>
          </div>
          ${s.config.rollFirst
            ? ''
            : (randomMode
              ? '<div class="setting-row"><span>地图 BP 先手</span>' + sideToggle('bpFirst', s.config.bpFirst, guest) + '</div>'
              : '<div class="setting-row"><span>选人先手</span>' + sideToggle('draftFirst', s.config.draftFirst, guest) + '</div>' +
                '<div class="setting-row"><span>地图 BP 先手</span>' + sideToggle('bpFirst', s.config.bpFirst, guest) + '</div>')}

          <div class="lobby-cta">
            ${randomMode
              ? '<button class="btn primary block" data-action="random-split" ' + (guest ? 'disabled' : '') + '>' +
                  (guest ? '等待房主开始' : '随机分组 <span class="arrow">→</span>') + '</button>'
              : '<button class="btn primary block" data-action="roll-captains" ' + (guest ? 'disabled' : '') + '>' +
                  (guest ? '等待房主开始' : '随机队长 <span class="arrow">→</span>') + '</button>' +
                '<button class="btn ghost block" data-action="toggle-manual" ' + (guest ? 'disabled' : '') + '>手动指定队长</button>'}
          </div>
          ${manualOpen && !guest && !randomMode ? manualPanel(s) : ''}
        </div>
      </div>
    </section>`;
  }

  function captainLinksPanel(s) {
    if (!s.captains) return '';
    var info = Net.info();
    if (info.mode === 'guest') {
      var label = info.side ? '你是 ' + info.side + ' 队长' : '你是观战者';
      var desc = info.side
        ? '只能为 ' + info.side + ' 队选人、在 ' + info.side + ' 队的回合 BP，并负责本队相关选边。'
        : '只能查看，无法参与选人、地图 BP 与选边。';
      return '<div class="identity-panel side-' + (info.side ? info.side.toLowerCase() : 'x') + '">' +
        '<b>' + label + '</b><span>' + desc + '</span></div>';
    }
    if (info.mode !== 'host') return '';
    return `
      <div class="link-panel">
        <div class="panel-head"><h3>队长专属链接</h3><span class="hint">链接按队伍区分，互相不能代选</span></div>
        ${['A', 'B'].map(function (side) {
          var url = Net.inviteUrl(side);
          var linked = info.sides[side];
          return '<div class="link-row side-' + side.toLowerCase() + '">' +
            '<span class="link-side">TEAM ' + side + '</span>' +
            '<code class="link-url">' + esc(url) + '</code>' +
            '<span class="link-state' + (linked ? ' on' : '') + '">' + (linked ? '已连接' : '等待加入') + '</span>' +
            '<button class="btn tiny" data-action="copy-captain-link" data-side="' + side + '"' +
            (url ? '' : ' disabled') + '>复制链接</button>' +
            '</div>';
        }).join('')}
      </div>`;
  }

  function rosterCard(s, side) {
    var picks = s.draft.picks.filter(function (p) { return p.side === side; });
    var cap = s.captains ? s.captains[side] : null;
    return '<div class="team-col side-' + side.toLowerCase() + ' roster-card">' +
      '<div class="tc-head"><span class="team-tag">TEAM ' + side + '</span>' +
      '<b>' + esc(capName(s, side)) + '</b><span class="tc-role">队长</span></div>' +
      '<ul class="roster">' +
      picks.map(function (p, i) {
        var isCap = cap === p.player;
        return '<li class="filled' + (isCap ? ' is-cap' : '') + '">' +
          '<span class="slot-no">' + (i + 1) + '</span>' +
          '<span class="slot-name">' + esc(playerName(s, p.player)) + '</span>' +
          (isCap ? '<span class="slot-cap">队长</span>' : '') +
          '</li>';
      }).join('') +
      '</ul></div>';
  }

  function rollPanel(s) {
    if (!s.config.rollFirst || !s.captains) return '';
    var roll = s.roll || { A: null, B: null };
    var done = rollDone(roll);
    var winner = done ? (roll.A > roll.B ? 'A' : 'B') : null;
    var guest = isGuest();
    var mySide = guest ? Net.info().side : null;

    function card(side) {
      var cls = 'roll-card side-' + side.toLowerCase();
      if (winner === side) cls += ' winner';
      var has = roll[side] !== null && roll[side] !== undefined;
      var foot = winner === side ? '先选人' : (done ? '后选人' : (has ? '已 Roll 点' : '待 Roll 点'));
      return '<div class="' + cls + '">' +
        '<span class="team-tag">TEAM ' + side + '</span>' +
        '<b class="roll-value" data-roll-value="' + side + '">' + (has ? roll[side] : '--') + '</b>' +
        '<span class="roll-foot">' + foot + '</span>' +
        '</div>';
    }

    var actions;
    if (guest) {
      if (!mySide) {
        actions = '<span class="hint">观战模式，等待两位队长自行 Roll 点</span>';
      } else if (roll[mySide] !== null && roll[mySide] !== undefined) {
        actions = '<span class="hint">你已 Roll 出 ' + roll[mySide] + ' 点，等待对手</span>';
      } else {
        actions = '<button class="btn primary sm" data-action="roll-first"' +
          (rollAnimating || disconnected ? ' disabled' : '') + '>ROLL 点</button>';
      }
    } else if (isOnline()) {
      var waiting = [];
      if (roll.A === null || roll.A === undefined) waiting.push('A');
      if (roll.B === null || roll.B === undefined) waiting.push('B');
      actions = waiting.length
        ? '<span class="hint">等待 ' + waiting.join(' / ') + ' 队长在自己的设备上 Roll 点</span>'
        : '<span class="hint">两位队长均已 Roll 点，3 秒后自动继续</span>';
    } else {
      var hasAny = (roll.A !== null && roll.A !== undefined) || (roll.B !== null && roll.B !== undefined);
      actions = '<button class="btn primary sm" data-action="roll-first"' + (rollAnimating ? ' disabled' : '') + '>' +
        (hasAny ? '重新 Roll 点' : '开始 Roll 点') + '</button>' +
        (done ? '<span class="hint">3 秒后自动进入下一步</span>' : '');
    }

    return '<div class="roll-panel">' +
      '<div class="panel-head"><h3>Roll 点决定先手</h3></div>' +
      '<div class="roll-stage">' + card('A') + '<span class="roll-vs">VS</span>' + card('B') + '</div>' +
      '<div class="roll-actions">' + actions +
      (winner ? '<span class="roll-result">队伍 ' + winner + ' 先选人</span>' : '') +
      '</div></div>';
  }

  function viewCaptains(s) {
    var random = s.config.mode === 'random';
    var needRoll = s.config.rollFirst && !rollDone(s.roll);
    var capA = s.captains ? capName(s, 'A') : null;
    var capB = s.captains ? capName(s, 'B') : null;
    return `
    <section class="view">
      <div class="view-head">
        <div><h2>${random ? '随机分组' : '队长确定'}</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <button class="btn ghost sm" data-action="back-lobby">返回配置</button>
        </div>
      </div>

      ${captainLinksPanel(s)}

      <div class="captain-stage">
        <div class="captain-card side-a ${capA ? 'revealed' : ''} ${rolling ? 'rolling' : ''}">
          <span class="team-tag">TEAM A</span>
          <div class="cap-name">${capA ? esc(capA) : '？？？'}</div>
          ${capA ? '' : '<span class="cap-foot">抽取中…</span>'}
        </div>
        <div class="vs-badge">VS</div>
        <div class="captain-card side-b ${capB ? 'revealed' : ''} ${rolling ? 'rolling' : ''}">
          <span class="team-tag">TEAM B</span>
          <div class="cap-name">${capB ? esc(capB) : '？？？'}</div>
          ${capB ? '' : '<span class="cap-foot">抽取中…</span>'}
        </div>
      </div>

      ${rollPanel(s)}

      ${random
        ? '<div class="roster-grid">' + rosterCard(s, 'A') + rosterCard(s, 'B') + '</div>'
        : `<div class="panel">
        <div class="panel-head"><h3>选手池</h3></div>
        <div class="player-grid">
          ${s.players.map(function (p, i) {
            var isA = s.captains && s.captains.A === i;
            var isB = s.captains && s.captains.B === i;
            var cls = 'player-chip';
            if (isA) cls += ' cap-a';
            if (isB) cls += ' cap-b';
            return '<div class="' + cls + '"><span class="pc-name">' + esc(p || '空位') + '</span>' +
              (isA ? '<span class="pc-badge a">A</span>' : '') +
              (isB ? '<span class="pc-badge b">B</span>' : '') +
              '</div>';
          }).join('')}
        </div>
      </div>`}

      <div class="actions">
        ${random
          ? '<button class="btn ghost" data-action="random-split" ' + ((rolling || isGuest()) ? 'disabled' : '') + '>重新分组</button>' +
            '<button class="btn primary" data-action="start-mapbp" ' + ((!s.captains || rolling || isGuest() || needRoll) ? 'disabled' : '') + '>开始地图 BP <span class="arrow">→</span></button>'
          : '<button class="btn ghost" data-action="roll-captains" ' + ((rolling || isGuest()) ? 'disabled' : '') + '>重新抽取</button>' +
            '<button class="btn primary" data-action="start-draft" ' + ((!s.captains || rolling || isGuest() || needRoll) ? 'disabled' : '') + '>开始选人 <span class="arrow">→</span></button>'}
        ${needRoll ? '<span class="hint">请先完成 Roll 点</span>' : ''}
      </div>
    </section>`;
  }

  function viewDraft(s) {
    // 常量兜底：即使浏览器缓存了旧版 draft.js，页面也能按 8 手 / 每队 4 人渲染
    var total = CSBP.Draft.TOTAL_PICKS || 8;
    var teamSize = CSBP.Draft.TEAM_PICKS || 4;
    var order = CSBP.Draft.order(s.draft.first, total);
    var done = s.draft.picks.length;
    var isDone = done >= total;
    var currentSide = isDone ? null : order[done];
    var mySide = guestSide();
    var canAct = !isGuest() || (!!mySide && mySide === currentSide && !disconnected);
    var pickedA = s.draft.picks.filter(function (p) { return p.side === 'A'; });
    var pickedB = s.draft.picks.filter(function (p) { return p.side === 'B'; });
    var taken = {};
    // 队长已固定在自己队伍中，不出现在可选列表
    if (s.captains) {
      taken[s.captains.A] = true;
      taken[s.captains.B] = true;
    }
    s.draft.picks.forEach(function (p) { taken[p.player] = true; });
    var available = [];
    for (var i = 0; i < 10; i += 1) {
      if (!taken[i]) available.push(i);
    }

    function teamColumn(side, picks) {
      var slots = '';
      for (var k = 0; k < teamSize; k += 1) {
        var p = picks[k];
        slots += '<li class="' + (p ? 'filled' : '') + '">' +
          '<span class="slot-no">' + (k + 1) + '</span>' +
          '<span class="slot-name">' + (p ? esc(playerName(s, p.player)) : '待选择') + '</span>' +
          '</li>';
      }
      return '<aside class="team-col side-' + side.toLowerCase() + '">' +
        '<div class="tc-head"><span class="team-tag">TEAM ' + side + '</span>' +
        '<b>' + esc(capName(s, side)) + '</b><span class="tc-role">队长</span></div>' +
        '<ul class="roster">' + slots + '</ul>' +
        '</aside>';
    }

    return `
    <section class="view">
      <div class="view-head">
        <div><h2>队长选人</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <span class="head-meta">第 ${Math.min(done + 1, total)} / ${total} 手</span>
        </div>
      </div>

      <div class="turn-banner side-${currentSide ? currentSide.toLowerCase() : 'a'}">
        <span class="turn-dot"></span>
        ${currentSide
          ? '<b>队伍 ' + currentSide + '</b><span>' + esc(capName(s, currentSide)) + ' 选人</span>'
          : '<b>选人完成</b>' + (isGuest() ? '<span>等待房主</span>' : '')}
        ${isGuest()
          ? '<span class="turn-role">' + (mySide ? '你是 ' + mySide + ' 队长' : '观战模式') +
            (canAct ? ' · 轮到你操作' : ' · 等待对方') + '</span>'
          : ''}
      </div>

      <div class="draft-board">
        ${teamColumn('A', pickedA)}
        <div class="draft-center">
          <div class="order-strip">
            ${order.map(function (side, idx) {
              var p = s.draft.picks[idx];
              return '<div class="order-slot side-' + side.toLowerCase() +
                (p ? ' done' : '') + (idx === done ? ' current' : '') + '">' +
                '<span class="os-no">' + (idx + 1) + '</span>' +
                '<span class="os-side">' + side + '</span>' +
                '<span class="os-name">' + (p ? esc(playerName(s, p.player)) : '') + '</span>' +
                '</div>';
            }).join('')}
          </div>
          <div class="panel pool-panel">
            <div class="panel-head"><h3>可选选手</h3></div>
            <div class="player-grid draft-pool">
              ${available.length
                ? available.map(function (idx) {
                    return '<button class="player-chip pickable side-' + (currentSide ? currentSide.toLowerCase() : 'a') +
                      '" data-action="pick-player" data-index="' + idx + '"' +
                      (canAct ? '' : ' disabled') + '>' + esc(playerName(s, idx)) + '</button>';
                  }).join('')
                : '<p class="empty">所有选手都已选完</p>'}
            </div>
          </div>
          ${isDone
            ? '<div class="actions">' + (isGuest()
                ? '<span class="hint">等待房主</span>'
                : '<button class="btn primary" data-action="finish-draft">进入下一步 <span class="arrow">→</span></button>') +
              '</div>'
            : ''}
        </div>
        ${teamColumn('B', pickedB)}
      </div>
    </section>`;
  }

  function teamPicksCard(side, s, picks) {
    return '<div class="bp-team side-' + side.toLowerCase() + '">' +
      '<div class="bpt-head"><span class="team-tag">TEAM ' + side + '</span>' +
      '<span class="bpt-cap">' + esc(capName(s, side)) + '</span></div>' +
      '<div class="bpt-maps">' +
      (picks.length
        ? picks.map(function (r) {
            var m = CSBP.Maps.get(r.mapId);
            var sideTag = s.mapbp.sides[r.mapId]
              ? '<i class="bpt-side">' + s.mapbp.sides[r.mapId] + '</i>'
              : '';
            return '<span class="bpt-map" style="--h:' + m.hue + '">' + esc(m.cn) + sideTag + '</span>';
          }).join('')
        : '<span class="bpt-empty">尚未选图</span>') +
      '</div></div>';
  }

  function sideChoicePanel(s) {
    var pending = s.mapbp.pending;
    if (!pending) return '';
    var map = CSBP.Maps.get(pending.mapId);
    var mySide = guestSide();
    var canSide = !isGuest() || (!!mySide && mySide === pending.side && !disconnected);
    return '<div class="side-panel side-' + pending.side.toLowerCase() + '">' +
      '<div class="sp-info"><span class="team-tag">TEAM ' + pending.side + '</span>' +
      '<b>' + esc(map.cn) + '</b>' +
      '<span class="sp-kind">' + (pending.kind === 'decider' ? '决胜图选边' : '地图选边') + '</span></div>' +
      '<div class="sp-actions">' +
      '<button class="btn side-btn ct" data-action="choose-side" data-value="CT"' + (canSide ? '' : ' disabled') + '>CT · 防守方</button>' +
      '<button class="btn side-btn t" data-action="choose-side" data-value="T"' + (canSide ? '' : ' disabled') + '>T · 进攻方</button>' +
      '</div>' +
      (isGuest() && !canSide ? '<span class="hint">等待 ' + pending.side + ' 队长选边</span>' : '') +
      '</div>';
  }

  function viewOrder(s) {
    var winner = rollWinner(s);
    var mySide = guestSide();
    var canAct = !isGuest() || (!!mySide && mySide === winner && !disconnected);
    var roll = s.roll;
    return `
    <section class="view">
      <div class="view-head">
        <div><h2>BAN 顺序</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <span class="head-meta">BO${s.config.series} · 图池 ${s.config.pool.length} 张</span>
        </div>
      </div>

      <div class="roll-panel">
        <div class="panel-head"><h3>Roll 点结果</h3></div>
        <div class="roll-stage">
          <div class="roll-card side-a ${winner === 'A' ? 'winner' : ''}">
            <span class="team-tag">TEAM A</span>
            <b class="roll-value">${roll ? roll.A : '--'}</b>
            <span class="roll-foot">${winner === 'A' ? '决定顺序' : '等待'}</span>
          </div>
          <span class="roll-vs">VS</span>
          <div class="roll-card side-b ${winner === 'B' ? 'winner' : ''}">
            <span class="team-tag">TEAM B</span>
            <b class="roll-value">${roll ? roll.B : '--'}</b>
            <span class="roll-foot">${winner === 'B' ? '决定顺序' : '等待'}</span>
          </div>
        </div>
      </div>

      <div class="order-panel side-${winner ? winner.toLowerCase() : 'a'}">
        <div class="panel-head"><h3>选择 BAN 顺序</h3>${winner ? '<span class="head-meta">TEAM ' + winner + '</span>' : ''}</div>
        <div class="order-stage">
          <button class="order-card" data-action="choose-order" data-first="1"${canAct ? '' : ' disabled'}>
            <b>先 BAN 图</b>
          </button>
          <button class="order-card" data-action="choose-order" data-first="0"${canAct ? '' : ' disabled'}>
            <b>后 BAN 图</b>
          </button>
        </div>
        ${isGuest() && !canAct ? '<p class="hint center">等待 ' + (winner || '') + ' 队长选择</p>' : ''}
      </div>
    </section>`;
  }

  function viewMapBP(s) {
    var stepIdx = s.mapbp.results.length;
    var step = s.mapbp.steps[stepIdx] || null;
    var pending = s.mapbp.pending;
    var mySide = guestSide();
    var canAct = !isGuest() || (!!mySide && !!step && mySide === step.side && !disconnected);
    var canSide = !isGuest() || (!!mySide && !!pending && mySide === pending.side && !disconnected);
    var used = {};
    s.mapbp.results.forEach(function (r) { used[r.mapId] = r; });

    var pickedA = s.mapbp.results.filter(function (r) { return r.type === 'pick' && r.side === 'A'; });
    var pickedB = s.mapbp.results.filter(function (r) { return r.type === 'pick' && r.side === 'B'; });

    var remaining = s.config.pool.filter(function (id) { return !used[id]; });
    var decider = remaining.length === 1 ? remaining[0] : null;
    var deciderSide = decider ? s.mapbp.sides[decider] : null;
    var pendingMap = pending ? CSBP.Maps.get(pending.mapId) : null;

    return `
    <section class="view">
      <div class="view-head">
        <div><h2>地图 BP</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <span class="head-meta">BO${s.config.series} · 图池 ${s.config.pool.length} 张</span>
        </div>
      </div>

      ${pending ? '<div class="turn-banner side-' + pending.side.toLowerCase() + '">' +
          '<span class="turn-dot"></span><b>队伍 ' + pending.side + '</b>' +
          '<span>选择「' + esc(pendingMap.cn) + '」的起始阵营</span>' +
          '<span class="turn-progress">' + (pending.kind === 'decider' ? '决胜图选边' : '地图选边') + '</span>' +
          (isGuest()
            ? '<span class="turn-role">' + (mySide ? '你是 ' + mySide + ' 队长' : '观战模式') +
              (canSide ? ' · 轮到你选边' : ' · 等待对方') + '</span>'
            : '') +
          '</div>'
        : (step ? '<div class="turn-banner side-' + step.side.toLowerCase() + '">' +
          '<span class="turn-dot"></span><b>队伍 ' + step.side + '</b>' +
          '<span>' + (step.type === 'ban' ? 'BAN 一张地图' : 'PICK 一张地图') + '</span>' +
          '<span class="turn-progress">第 ' + (stepIdx + 1) + ' / ' + s.mapbp.steps.length + ' 步</span>' +
          (isGuest()
            ? '<span class="turn-role">' + (mySide ? '你是 ' + mySide + ' 队长' : '观战模式') +
              (canAct ? ' · 轮到你操作' : ' · 等待对方') + '</span>'
            : '') +
          '</div>' : '')}

      ${sideChoicePanel(s)}

      <div class="step-strip">
        ${s.mapbp.steps.map(function (st, i) {
          var res = s.mapbp.results[i];
          var map = res ? CSBP.Maps.get(res.mapId) : null;
          var sideTag = res && s.mapbp.sides[res.mapId] ? ' · ' + s.mapbp.sides[res.mapId] : '';
          var cls = 'bp-step side-' + st.side.toLowerCase();
          if (res) cls += ' done';
          if (i === stepIdx && !pending) cls += ' current';
          return '<div class="' + cls + '">' +
            '<span class="bps-side">' + st.side + '</span>' +
            '<span class="bps-type">' + (st.type === 'ban' ? 'BAN' : 'PICK') + '</span>' +
            '<span class="bps-map">' + (map ? esc(map.cn) + sideTag : (i === stepIdx ? '进行中' : '—')) + '</span>' +
            '</div>';
        }).join('')}
      </div>

      <div class="bp-layout">
        <div class="panel bp-panel">
          <div class="panel-head"><h3>选择地图</h3></div>
          <div class="map-grid">
            ${s.config.pool.map(function (id) {
              var m = CSBP.Maps.get(id);
              var res = used[id];
              var cls = 'map-card';
              var label = '';
              if (res) {
                cls += ' used ' + res.type + ' side-' + res.side.toLowerCase();
                var sideText = s.mapbp.sides[id] ? ' · ' + s.mapbp.sides[id] : '';
                label = '<span class="map-state">' + res.side + ' ' + (res.type === 'ban' ? 'BAN' : 'PICK') + sideText + '</span>';
              } else if (step && !pending) {
                cls += ' active';
              }
              return '<button class="' + cls + '" style="--h:' + m.hue + '" ' +
                (res || !step || !canAct || pending ? 'disabled' : '') +
                ' data-action="bp-act" data-map="' + id + '">' +
                '<span class="map-art"></span>' +
                '<span class="map-info"><b>' + esc(m.cn) + '</b><i>' + esc(m.en) + '</i></span>' +
                label +
                '</button>';
            }).join('')}
          </div>
        </div>

        <aside class="bp-side">
          ${teamPicksCard('A', s, pickedA)}
          ${teamPicksCard('B', s, pickedB)}
          <div class="decider-card">
            <span class="dc-label">${s.config.series === 1 ? '比赛地图' : '决胜图'}</span>
            <b>${decider ? esc(CSBP.Maps.get(decider).cn) : '待定'}</b>
            <span class="dc-en">${decider
              ? esc(CSBP.Maps.get(decider).en) + (deciderSide ? ' · 选边 ' + deciderSide : (pending && pending.kind === 'decider' ? ' · 选边中' : ''))
              : '剩余 ' + remaining.length + ' 张图'}</span>
          </div>
        </aside>
      </div>
    </section>`;
  }

  function resultTeamCard(side, s) {
    var picks = s.draft.picks.filter(function (p) { return p.side === side; });
    return '<div class="result-team side-' + side.toLowerCase() + '">' +
      '<div class="rt-head"><span class="team-tag">TEAM ' + side + '</span>' +
      '<b>' + esc(capName(s, side)) + '</b><span class="rt-role">队长</span></div>' +
      '<ul class="rt-list">' +
      picks.map(function (p, i) {
        return '<li><span>' + (i + 1) + '</span>' + esc(playerName(s, p.player)) + '</li>';
      }).join('') +
      '</ul></div>';
  }

  function viewResult(s) {
    var maps = CSBP.MapBP.decidedMaps(s);
    var guest = isGuest();
    return `
    <section class="view result-view">
      ${roomPill() ? '<div class="result-online">' + roomPill() + '</div>' : ''}
      <div class="result-hero">
        <h2>BP 完成</h2>
      </div>

      <div class="result-teams">
        ${resultTeamCard('A', s)}
        ${resultTeamCard('B', s)}
      </div>

      <div class="panel result-maps">
        <div class="panel-head">
          <h3>比赛地图</h3>
        </div>
        <ol class="map-order">
          ${maps.map(function (item, i) {
            var map = CSBP.Maps.get(item.mapId);
            var side = s.mapbp.sides[item.mapId];
            var tag = item.type === 'decider'
              ? (s.config.series === 1 ? '比赛地图' : '决胜图')
              : item.side + ' 队选';
            if (side) tag += ' · 选边 ' + side;
            var cls = item.type === 'decider' ? 'decider' : 'picked side-' + item.side.toLowerCase();
            return '<li class="' + cls + '">' +
              '<span class="mo-no">' + (i + 1) + '</span>' +
              '<span class="mo-art" style="--h:' + map.hue + '"></span>' +
              '<span class="mo-name"><b>' + esc(map.cn) + '</b><i>' + esc(map.en) + '</i></span>' +
              '<span class="mo-tag">' + tag + '</span>' +
              '</li>';
          }).join('')}
        </ol>
      </div>

      <div class="actions">
        <button class="btn primary" data-action="copy-report">复制战报</button>
        ${guest
          ? '<button class="btn ghost" data-action="leave-room">离开房间</button>'
          : '<button class="btn ghost" data-action="again">再来一局</button><button class="btn ghost" data-action="back-lobby">返回大厅</button><button class="btn danger-ghost" data-action="reset-all">清空重开</button>'}
      </div>
    </section>`;
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                                */
  /* ------------------------------------------------------------------ */

  function stepper(phase, config) {
    var defs = stepDefsFor(config);
    var current = -1;
    defs.forEach(function (st, i) {
      if (st.key === phase) current = i;
    });
    return '<div class="stepper">' + defs.map(function (st, i) {
      var cls = 'step';
      if (i < current) cls += ' done';
      if (i === current) cls += ' active';
      var label = (config.mode === 'random' && st.key === 'captains') ? '随机分组' : st.label;
      return '<div class="' + cls + '">' +
        '<span class="step-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="step-label">' + label + '</span>' +
        '</div>';
    }).join('<span class="step-line"></span>') + '</div>';
  }

  function updateModeTag() {
    var tag = document.getElementById('modeTag');
    var text = document.getElementById('modeText');
    if (!tag || !text) return;
    var info = Net.info();
    if (info.mode === 'local') {
      tag.hidden = true;
      return;
    }
    tag.hidden = false;
    tag.classList.add('online');
    text.textContent = '在线 · ' + (info.mode === 'host'
      ? '房主'
      : (info.side ? info.side + ' 队长' : '观战'));
  }

  // Roll 点完成后 3 秒自动进入下一步（仅房主 / 本地模式推进，访客跟随房主状态）
  function clearAutoNext() {
    if (autoNextTimer) {
      window.clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }
    autoNextKey = null;
  }

  function scheduleAutoNext(s) {
    var eligible = !isGuest() && !rollAnimating && !rolling && s.phase === 'captains' && s.captains &&
      s.config.rollFirst && rollDone(s.roll) && poolProblem(s) === '';
    if (!eligible) {
      clearAutoNext();
      return;
    }
    var key = s.config.mode + '|' + s.captains.A + '|' + s.captains.B + '|' + s.roll.A + '|' + s.roll.B;
    if (autoNextTimer && autoNextKey === key) return;
    clearAutoNext();
    autoNextKey = key;
    autoNextTimer = window.setTimeout(function () {
      autoNextTimer = null;
      autoNextKey = null;
      var cur = Store.state;
      if (cur.phase !== 'captains' || !cur.config.rollFirst || !Store.rollDone(cur.roll)) return;
      if (poolProblem(cur)) return;
      if (cur.config.mode === 'random') startMapBP();
      else startDraft();
    }, 3000);
  }

  function render() {
    var s = Store.state;
    applyTitle(s.config.game);
    var body;
    switch (s.phase) {
      case 'lobby': body = viewLobby(s); break;
      case 'captains': body = viewCaptains(s); break;
      case 'draft': body = viewDraft(s); break;
      case 'order': body = viewOrder(s); break;
      case 'mapbp': body = viewMapBP(s); break;
      case 'result': body = viewResult(s); break;
      default: body = viewHome();
    }
    updateModeTag();
    app.innerHTML = (s.phase === 'home' ? '' : stepper(s.phase, s.config)) + body;

    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      var viewEl = app.querySelector('.view');
      if (viewEl) viewEl.classList.add('animate');
      window.scrollTo(0, 0);
    }
    scheduleAutoNext(s);
  }

  /* ------------------------------------------------------------------ */
  /* 交互                                                                */
  /* ------------------------------------------------------------------ */

  function toast(message, type) {
    if (!toastHost) return;
    var el = document.createElement('div');
    el.className = 'toast-item' + (type ? ' ' + type : '');
    el.textContent = message;
    toastHost.appendChild(el);
    window.requestAnimationFrame(function () { el.classList.add('show'); });
    window.setTimeout(function () {
      el.classList.remove('show');
      window.setTimeout(function () { el.remove(); }, 280);
    }, 2400);
  }

  function togglePoolMap(id) {
    if (isGuest()) {
      toast('图池由房主统一设置', 'warn');
      return;
    }
    var s = Store.state;
    var pool = s.config.pool.slice();
    var index = pool.indexOf(id);
    if (index >= 0) {
      pool.splice(index, 1);
    } else {
      pool.push(id);
    }
    Store.setPool(pool);
    render();
  }

  function applyPoolPreset(kind) {
    if (isGuest()) {
      toast('图池由房主统一设置', 'warn');
      return;
    }
    Store.setPoolMode(kind === 'all' ? 'all' : 'active');
    if (kind === 'all') {
      toast('已显示全部 ' + Store.state.config.pool.length + ' 张地图');
    } else {
      toast('已切换为现役七图');
    }
    render();
  }

  function flashRandomChip() {
    var chips = app.querySelectorAll('.player-chip');
    if (!chips.length) return;
    var el = chips[Math.floor(Math.random() * chips.length)];
    el.classList.add('flash');
    window.setTimeout(function () { el.classList.remove('flash'); }, 160);
  }

  function rollCaptains() {
    if (isGuest()) {
      toast('随机队长由房主操作', 'warn');
      return;
    }
    if (rolling) return;
    var s = Store.state;
    var missing = 0;
    s.players.forEach(function (p) { if (!String(p).trim()) missing += 1; });
    if (missing > 0) {
      toast('还有 ' + missing + ' 名选手未填写 ID');
      return;
    }
    var problem = poolProblem(s);
    if (problem) {
      toast(problem, 'warn');
      return;
    }

    manualOpen = false;
    var token = ++rollToken;
    rolling = true;
    Store.clearCaptainsPhase();
    render();

    var ticker = window.setInterval(flashRandomChip, 80);
    window.setTimeout(function () {
      window.clearInterval(ticker);
      if (token !== rollToken || Store.state.phase !== 'captains') {
        rolling = false;
        return;
      }
      var pair = CSBP.Draft.randomPair(10);
      Store.setCaptains(pair.a, pair.b);
      rolling = false;
      render();
      toast('两名队长已抽取');
    }, 1700);
  }

  function doRollFirst() {
    if (rollAnimating) return;
    var s = Store.state;

    // 队长在自己的设备上 Roll 自己的点数
    if (isGuest()) {
      var side = Net.info().side;
      if (!Net.info().connected) {
        toast('正在等待与房主连接…', 'warn');
        return;
      }
      if (!side) {
        toast('观战模式，无法 Roll 点', 'warn');
        return;
      }
      if (s.roll && s.roll[side] !== null && s.roll[side] !== undefined) {
        toast('你已完成 Roll 点', 'warn');
        return;
      }
      rollAnimating = true;
      render();
      var guestToken = ++rollAnimToken;
      var guestTicker = window.setInterval(function () {
        var el = app.querySelector('[data-roll-value="' + side + '"]');
        if (el) el.textContent = String(CSBP.Draft.randInt(100) + 1);
      }, 70);
      window.setTimeout(function () {
        window.clearInterval(guestTicker);
        if (guestToken !== rollAnimToken) return;
        rollAnimating = false;
        var value = CSBP.Draft.randInt(100) + 1;
        if (!Net.sendAction({ type: 'roll', value: value })) {
          toast('Roll 点发送失败，请稍后重试', 'warn');
          render();
          return;
        }
        toast('队伍 ' + side + ' Roll 出 ' + value + ' 点，等待对手', 'ok');
        // 兜底：若长时间未收到房主同步则恢复按钮
        window.setTimeout(function () {
          var cur = Store.state.roll;
          if (!cur || cur[side] === null || cur[side] === undefined) render();
        }, 3000);
      }, 1100);
      return;
    }

    if (isOnline()) {
      toast('Roll 点由两位队长各自操作', 'warn');
      return;
    }

    // 单机模式：本机可代两队同时 Roll
    rollAnimating = true;
    render();

    var token = ++rollAnimToken;
    var ticker = window.setInterval(function () {
      var a = app.querySelector('[data-roll-value="A"]');
      var b = app.querySelector('[data-roll-value="B"]');
      if (a) a.textContent = String(CSBP.Draft.randInt(100) + 1);
      if (b) b.textContent = String(CSBP.Draft.randInt(100) + 1);
    }, 70);

    window.setTimeout(function () {
      window.clearInterval(ticker);
      if (token !== rollAnimToken) return;
      rollAnimating = false;

      var a = CSBP.Draft.randInt(100) + 1;
      var b = CSBP.Draft.randInt(100) + 1;
      while (b === a) b = CSBP.Draft.randInt(100) + 1;

      Store.setRoll(a, b);
      render();
      var winner = a > b ? 'A' : 'B';
      toast('队伍 ' + winner + ' 先选人（Roll ' + a + ' : ' + b + '）', 'ok');
    }, 1100);
  }

  function toggleManualCaptains() {
    if (isGuest()) {
      toast('队长由房主指定', 'warn');
      return;
    }
    manualOpen = !manualOpen;
    render();
  }

  function confirmManualCaptains() {
    if (isGuest()) return;
    if (manualA < 0 || manualB < 0) {
      toast('请选择两名队长', 'warn');
      return;
    }
    if (manualA === manualB) {
      toast('两名队长不能是同一名选手', 'warn');
      return;
    }
    var problem = poolProblem(Store.state);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    rollToken += 1;
    rolling = false;
    manualOpen = false;
    Store.setCaptains(manualA, manualB);
    render();
    toast('队长已指定 / A：' + playerName(Store.state, manualA) +
      ' · B：' + playerName(Store.state, manualB));
  }

  function startDraft() {
    if (isGuest()) {
      toast('由房主开始选人', 'warn');
      return;
    }
    if (!Store.state.captains) {
      toast('请先抽取队长');
      return;
    }
    if (Store.state.config.rollFirst && !rollDone(Store.state.roll)) {
      toast('请先完成 Roll 点决定先手', 'warn');
      return;
    }
    var problem = poolProblem(Store.state);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    Store.startDraft();
    render();
    toast('选人开始：队伍 ' + Store.state.draft.first + ' 先选人');
  }

  function handleRandomSplit() {
    if (isGuest()) {
      toast('随机分组由房主操作', 'warn');
      return;
    }
    if (rolling) return;
    var s = Store.state;
    var missing = 0;
    s.players.forEach(function (p) { if (!String(p).trim()) missing += 1; });
    if (missing > 0) {
      toast('还有 ' + missing + ' 名选手未填写 ID');
      return;
    }
    var problem = poolProblem(s);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    manualOpen = false;
    Store.randomSplit();
    render();
    toast('已随机分组');
  }

  function startMapBP() {
    if (isGuest()) {
      toast('由房主开始地图 BP', 'warn');
      return;
    }
    if (!Store.state.captains) {
      toast('请先确定队伍');
      return;
    }
    if (Store.state.config.rollFirst && !rollDone(Store.state.roll)) {
      toast('请先完成 Roll 点决定先手', 'warn');
      return;
    }
    var problem = poolProblem(Store.state);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    Store.startMapBP();
    render();
    if (Store.state.phase === 'order') {
      var winner = rollWinner(Store.state);
      toast('请由队伍 ' + winner + ' 选择先 BAN 或后 BAN', 'ok');
    } else {
      toast('地图 BP 开始：队伍 ' + Store.state.mapbp.first + ' 先手');
    }
  }

  function commitPick(index) {
    var s = Store.state;
    if (s.phase !== 'draft' || !s.captains) return false;
    var order = CSBP.Draft.order(s.draft.first, CSBP.Draft.TOTAL_PICKS);
    var side = order[s.draft.picks.length];
    var name = playerName(s, index);
    if (!Store.pickPlayer(index)) return false;
    render();
    if (Store.state.phase === 'mapbp') {
      toast('选人完成，进入地图 BP');
    } else if (Store.state.phase === 'order') {
      toast('选人完成，请由 Roll 胜者选择 BAN 顺序');
    } else {
      toast('队伍 ' + side + ' 选中 ' + name);
    }
    return true;
  }

  function commitBp(mapId) {
    var s = Store.state;
    var step = s.mapbp.steps[s.mapbp.results.length];
    if (!step || s.mapbp.pending) return false;
    var map = CSBP.Maps.get(mapId);
    if (!map || !Store.bpAct(mapId)) return false;
    render();
    if (step.type === 'pick') {
      toast('队伍 ' + step.side + ' 选中 ' + map.cn + '，由队伍 ' +
        CSBP.Draft.flip(step.side) + ' 选边');
    } else {
      toast('队伍 ' + step.side + ' BAN 掉 ' + map.cn);
    }
    return true;
  }

  function commitOrder(first) {
    if (Store.state.phase !== 'order') return false;
    if (!Store.setBanOrder(first === true)) return false;
    render();
    toast('BAN 顺序已定：队伍 ' + Store.state.mapbp.first + ' 先 BAN');
    return true;
  }

  function commitSide(value) {
    var pending = Store.state.mapbp.pending;
    if (!pending) return false;
    var map = CSBP.Maps.get(pending.mapId);
    if (!Store.bpSide(value)) return false;
    render();
    if (Store.state.phase === 'result') {
      toast('地图 BP 完成');
    } else if (pending.kind === 'decider') {
      toast('决胜图 ' + map.cn + ' 由队伍 ' + pending.side + ' 选择 ' + value);
    } else {
      toast('队伍 ' + pending.side + ' 为 ' + map.cn + ' 选择 ' + value);
    }
    return true;
  }

  function handlePick(index) {
    if (disconnected) {
      toast('连接已断开，仅可查看', 'warn');
      return;
    }
    if (isGuest()) {
      if (!Net.info().connected) {
        toast('正在等待与房主连接…', 'warn');
        return;
      }
      if (!Net.info().side) {
        toast('观战模式，无法参与选人', 'warn');
        return;
      }
      if (Net.info().side !== actingSide(Store.state)) {
        toast('还没轮到你们队选人', 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'pick', index: index })) {
        toast('操作发送失败，请稍后重试', 'warn');
      }
      return;
    }
    commitPick(index);
  }

  function handleBpAct(mapId) {
    if (disconnected) {
      toast('连接已断开，仅可查看', 'warn');
      return;
    }
    if (Store.state.mapbp.pending) {
      toast('请先完成当前选边', 'warn');
      return;
    }
    if (isGuest()) {
      if (!Net.info().connected) {
        toast('正在等待与房主连接…', 'warn');
        return;
      }
      if (!Net.info().side) {
        toast('观战模式，无法进行地图 BP', 'warn');
        return;
      }
      if (Net.info().side !== actingSide(Store.state)) {
        toast('还没轮到你们队操作', 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'bp', mapId: mapId })) {
        toast('操作发送失败，请稍后重试', 'warn');
      }
      return;
    }
    commitBp(mapId);
  }

  function handleOrder(first) {
    if (disconnected) {
      toast('连接已断开，仅可查看', 'warn');
      return;
    }
    if (isGuest()) {
      if (!Net.info().connected) {
        toast('正在等待与房主连接…', 'warn');
        return;
      }
      if (!Net.info().side) {
        toast('观战模式，无法选择 BAN 顺序', 'warn');
        return;
      }
      if (Net.info().side !== rollWinner(Store.state)) {
        toast('只有 Roll 胜者可以选择 BAN 顺序', 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'order', first: first === true })) {
        toast('操作发送失败，请稍后重试', 'warn');
      }
      return;
    }
    commitOrder(first);
  }

  function handleSide(value) {
    if (disconnected) {
      toast('连接已断开，仅可查看', 'warn');
      return;
    }
    var pending = Store.state.mapbp.pending;
    if (!pending) return;
    if (isGuest()) {
      if (!Net.info().connected) {
        toast('正在等待与房主连接…', 'warn');
        return;
      }
      if (!Net.info().side) {
        toast('观战模式，无法选边', 'warn');
        return;
      }
      if (Net.info().side !== pending.side) {
        toast('由队伍 ' + pending.side + ' 选边', 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'side', value: value })) {
        toast('操作发送失败，请稍后重试', 'warn');
      }
      return;
    }
    commitSide(value);
  }

  // 房主执行访客发来的操作：按动作类型校验阶段与队伍身份
  function applyRemoteAction(action, side) {
    if (!action || Net.info().mode !== 'host') return;
    if (side !== 'A' && side !== 'B') return;
    var s = Store.state;
    if (action.type === 'pick') {
      if (s.phase !== 'draft' || side !== actingSide(s)) return;
      commitPick(Number(action.index));
    } else if (action.type === 'bp') {
      if (s.phase !== 'mapbp' || s.mapbp.pending || side !== actingSide(s)) return;
      commitBp(String(action.mapId));
    } else if (action.type === 'side') {
      if (s.phase !== 'mapbp' || !s.mapbp.pending || s.mapbp.pending.side !== side) return;
      var value = String(action.value);
      if (value !== 'CT' && value !== 'T') return;
      commitSide(value);
    } else if (action.type === 'order') {
      if (s.phase !== 'order' || side !== rollWinner(s)) return;
      commitOrder(action.first === true);
    } else if (action.type === 'roll') {
      if (s.phase !== 'captains' || !s.config.rollFirst || !s.captains) return;
      var value = Number(action.value);
      if (!Number.isInteger(value) || value < 1 || value > 100) return;
      if (!Store.setRollSide(side, value)) return;
      var nextRoll = Store.state.roll;
      if (nextRoll && nextRoll.A !== null && nextRoll.B !== null) {
        if (nextRoll.A === nextRoll.B) {
          Store.resetRoll();
          toast('双方都 Roll 到 ' + nextRoll.A + ' 点，平局，请重新 Roll 点', 'warn');
        } else {
          var rollWin = nextRoll.A > nextRoll.B ? 'A' : 'B';
          toast('队伍 ' + rollWin + ' 先选人（Roll ' + nextRoll.A + ' : ' + nextRoll.B + '）', 'ok');
        }
      } else {
        toast('队伍 ' + side + ' Roll 出 ' + value + ' 点', 'ok');
      }
      render();
    }
  }

  function beginGuestRoll() {
    if (guestRollTicker) return;
    rolling = true;
    render();
    guestRollTicker = window.setInterval(flashRandomChip, 80);
    // 兜底：若房主长时间未返回结果则停止动画
    guestRollTimer = window.setTimeout(function () {
      stopGuestRoll();
      render();
    }, 8000);
  }

  function stopGuestRoll() {
    if (guestRollTicker) {
      window.clearInterval(guestRollTicker);
      guestRollTicker = null;
    }
    if (guestRollTimer) {
      window.clearTimeout(guestRollTimer);
      guestRollTimer = null;
    }
    rolling = false;
  }

  function handleRemoteState(raw) {
    if (!Store.applyRemote(raw)) return;
    var s = Store.state;
    if (s.phase === 'captains' && !s.captains) {
      beginGuestRoll();
      return;
    }
    if (guestRollTicker) {
      stopGuestRoll();
      render();
      if (s.captains) toast('两名队长已抽取');
      return;
    }
    render();
  }

  function copyReport() {
    var text = CSBP.Share.buildReport(Store.state);
    CSBP.Share.copy(text).then(function (ok) {
      toast(ok ? '战报已复制到剪贴板' : '复制失败，请手动复制', ok ? 'ok' : 'warn');
    });
  }

  function clearRoomInUrl() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete('room');
      url.searchParams.delete('side');
      url.searchParams.delete('key');
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  function copyCaptainLink(side) {
    if (Net.info().mode !== 'host') return;
    var url = Net.inviteUrl(side);
    if (!url) {
      toast('请先创建在线房间', 'warn');
      return;
    }
    CSBP.Share.copy(url).then(function (ok) {
      if (ok) toast(side + ' 队长链接已复制', 'ok');
      else toast('复制失败，请手动复制：' + url, 'warn');
    });
  }

  function resetRoomUi() {
    stopGuestRoll();
    rollAnimToken += 1;
    rollAnimating = false;
    disconnected = false;
    joinOpen = false;
    joiningRoom = false;
    joinCodeValue = '';
    manualOpen = false;
    manualA = -1;
    manualB = -1;
  }

  function createOnlineRoom() {
    if (creatingRoom) return;
    if (isOnline()) {
      toast('请先离开当前房间', 'warn');
      return;
    }
    creatingRoom = true;
    joinOpen = false;
    manualOpen = false;
    render();
    Net.createRoom(function () { return Store.snapshot(); }).then(function (res) {
      creatingRoom = false;
      disconnected = false;
      clearRoomInUrl();
      Store.setPhase('lobby');
      render();
      if (res.local) {
        toast('联机服务器不可用，已切换为本机联机：请在同一浏览器新标签打开队长链接', 'warn');
      } else if (res.server === 'relay') {
        toast('房间已创建（本地信令），房间码 ' + res.code, 'ok');
      } else {
        toast('房间已创建，房间码 ' + res.code, 'ok');
      }
    }).catch(function (err) {
      creatingRoom = false;
      render();
      toast((err && err.message) || '创建房间失败', 'warn');
    });
  }

  function joinOnlineRoom(side, token) {
    if (joiningRoom) return;
    var code = Net.normalizeCode(joinCodeValue);
    if (code.length !== 5) {
      toast('请输入 5 位房间码', 'warn');
      return;
    }
    joiningRoom = true;
    joinCodeValue = code;
    render();
    Net.joinRoom(code, { side: side || null, token: token || '' }).then(function () {
      joiningRoom = false;
      disconnected = false;
      joinOpen = false;
      render();
      var info = Net.info();
      var role = info.side ? '身份：' + info.side + ' 队长' : '观战';
      toast(info.localOnly ? '已加入本机联机房间（' + role + '）' : '已加入房间，' + role, 'ok');
    }).catch(function (err) {
      joiningRoom = false;
      render();
      toast((err && err.message) || '加入房间失败', 'warn');
    });
  }

  function leaveRoom() {
    if (!isOnline()) {
      Store.setPhase('home');
      render();
      return;
    }
    var guest = isGuest();
    if (!window.confirm(guest ? '确定离开房间吗？' : '确定关闭房间吗？')) return;
    Net.leave();
    clearRoomInUrl();
    resetRoomUi();
    if (guest) {
      Store.resetAll();
      lastPhase = null;
    }
    render();
    toast(guest ? '已离开房间' : '房间已关闭，当前为单机模式', 'ok');
  }

  function exitToHome() {
    if (isOnline() && !window.confirm(isGuest() ? '确定离开房间并返回首页吗？' : '确定关闭房间并返回首页吗？')) {
      return;
    }
    if (isOnline()) {
      var guest = isGuest();
      Net.leave();
      clearRoomInUrl();
      resetRoomUi();
      if (guest) Store.resetAll();
      lastPhase = null;
    }
    Store.setPhase('home');
    render();
  }

  function resetAll() {
    if (!window.confirm('确定清空全部本地数据并回到首页吗？')) return;
    rollToken += 1;
    rolling = false;
    Net.leave();
    clearRoomInUrl();
    resetRoomUi();
    Store.resetAll();
    lastPhase = null;
    render();
    toast('已清空所有数据');
  }

  function requireGame() {
    if (Store.state.config.game) return true;
    toast('请先选择游戏', 'warn');
    return false;
  }

  function handleAction(action, el) {
    switch (action) {
      case 'select-game':
        if (isOnline()) return;
        joinOpen = false;
        Store.setGame(el.getAttribute('data-game'));
        render();
        break;
      case 'create-online':
        if (!requireGame()) return;
        createOnlineRoom();
        break;
      case 'show-join':
        if (!requireGame()) return;
        joinOpen = true;
        render();
        window.setTimeout(function () {
          var input = document.getElementById('joinCode');
          if (input) input.focus();
        }, 30);
        break;
      case 'hide-join':
        if (joiningRoom) return;
        joinOpen = false;
        render();
        break;
      case 'join-online':
        joinOnlineRoom();
        break;
      case 'copy-captain-link':
        copyCaptainLink(el.getAttribute('data-side'));
        break;
      case 'leave-room':
        leaveRoom();
        break;
      case 'go-home':
        exitToHome();
        break;
      case 'enter-lobby':
        if (isOnline()) {
          toast('请先离开当前房间', 'warn');
          return;
        }
        if (!requireGame()) return;
        Store.setPhase('lobby');
        render();
        break;
      case 'back-lobby':
        if (isGuest()) {
          toast('由房主返回大厅', 'warn');
          return;
        }
        manualOpen = false;
        Store.setPhase('lobby');
        render();
        break;
      case 'show-rules': {
        var rules = document.getElementById('rules');
        if (rules) {
          rules.open = true;
          rules.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        break;
      }
      case 'set-series':
        if (isGuest()) return;
        Store.setSeries(Number(el.getAttribute('data-series')));
        render();
        break;
      case 'set-mode':
        if (isGuest()) return;
        manualOpen = false;
        Store.setMode(el.getAttribute('data-mode'));
        render();
        break;
      case 'set-roll-first':
        if (isGuest()) return;
        Store.setRollFirst(el.getAttribute('data-value') === 'on');
        render();
        break;
      case 'toggle-map':
        togglePoolMap(el.getAttribute('data-map'));
        break;
      case 'preset-pool':
        applyPoolPreset(el.getAttribute('data-preset'));
        break;
      case 'set-first':
        if (isGuest()) return;
        Store.setFirst(el.getAttribute('data-field'), el.getAttribute('data-value'));
        render();
        break;
      case 'roll-captains':
        rollCaptains();
        break;
      case 'roll-first':
        doRollFirst();
        break;
      case 'random-split':
        handleRandomSplit();
        break;
      case 'start-mapbp':
        startMapBP();
        break;
      case 'toggle-manual':
        toggleManualCaptains();
        break;
      case 'confirm-manual-captains':
        confirmManualCaptains();
        break;
      case 'start-draft':
        startDraft();
        break;
      case 'pick-player':
        handlePick(Number(el.getAttribute('data-index')));
        break;
      case 'finish-draft':
        if (isGuest()) {
          toast('请由房主进入下一步', 'warn');
          return;
        }
        if (Store.finishDraft()) {
          render();
          toast('选人完成，进入下一步');
        } else {
          toast('还有选手未选完', 'warn');
        }
        break;
      case 'bp-act':
        handleBpAct(el.getAttribute('data-map'));
        break;
      case 'choose-order':
        handleOrder(el.getAttribute('data-first') === '1');
        break;
      case 'choose-side':
        handleSide(el.getAttribute('data-value'));
        break;
      case 'copy-report':
        copyReport();
        break;
      case 'again':
        if (isGuest()) {
          toast('由房主开始新一局', 'warn');
          return;
        }
        manualOpen = false;
        Store.newRound();
        render();
        toast('已保留名单与配置，重新开始');
        break;
      case 'reset-all':
        if (isGuest()) {
          toast('清空数据请先在房主端操作', 'warn');
          return;
        }
        resetAll();
        break;
      case 'toggle-theme':
        applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
        break;
      default:
        break;
    }
  }

  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (!action) return;
    handleAction(action, target);
  });

  app.addEventListener('input', function (e) {
    var joinInput = e.target.closest('#joinCode');
    if (joinInput) {
      joinCodeValue = Net.normalizeCode(joinInput.value);
      if (joinInput.value !== joinCodeValue) joinInput.value = joinCodeValue;
      return;
    }
    var input = e.target.closest('[data-player]');
    if (!input) return;
    Store.setPlayer(Number(input.getAttribute('data-player')), input.value);
  });

  app.addEventListener('change', function (e) {
    var select = e.target.closest('[data-manual-side]');
    if (!select) return;
    var side = select.getAttribute('data-manual-side');
    var value = Number(select.value);
    if (side === 'A') manualA = value;
    else manualB = value;
  });

  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target && e.target.id === 'joinCode') {
      e.preventDefault();
      joinOnlineRoom();
    }
  });

  Net.init({
    onState: handleRemoteState,
    onStatus: function () {
      updateModeTag();
      render();
    },
    onAction: applyRemoteAction,
    onJoin: function (side) {
      if (side) toast(side + ' 队长已加入房间', 'ok');
      render();
    },
    onDisconnect: function (msg, role) {
      disconnected = role === 'guest';
      toast(msg, 'warn');
      render();
    }
  });

  // 房主本地状态变化后同步给队长（内部已做 40ms 合并）
  Store.subscribe(function () {
    if (Net.info().mode === 'host') Net.broadcast();
  });

  (function initFromUrl() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return;
    }
    var room = Net.normalizeCode(params.get('room'));
    if (room.length !== 5) return;

    joinOpen = true;
    joinCodeValue = room;
    Store.setPhase('home');

    // 队长专属链接：自动带身份加入
    var side = params.get('side');
    var key = params.get('key') || '';
    if (side === 'A' || side === 'B') {
      window.setTimeout(function () {
        joinOnlineRoom(side, key);
      }, 0);
    }
  })();

  initTheme();
  applySiteConfig();
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
  render();
})();
