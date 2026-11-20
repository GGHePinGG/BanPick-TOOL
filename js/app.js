(function () {
  'use strict';

  var CSBP = window.CSBP;
  var Store = CSBP.Store;
  var Net = CSBP.Net;
  var app = document.getElementById('app');
  var toastHost = document.getElementById('toast');

  var STEP_DEFS = [
    { key: 'lobby', label: '房间配置', labelEn: 'Room Setup' },
    { key: 'captains', label: '确定队长', labelEn: 'Captains' },
    { key: 'draft', label: '队长选人', labelEn: 'Draft' },
    { key: 'order', label: 'BAN 顺序', labelEn: 'Ban Order' },
    { key: 'mapbp', label: '地图 BP', labelEn: 'Map Ban/Pick' },
    { key: 'result', label: 'BP 结果', labelEn: 'BP Result' }
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
    brandTextEn: 'BP ARENA',
    heroTitle1: '在线 <span class="grad">BP</span>',
    heroTitle2: '队长选人 · 地图博弈',
    heroTitle1En: 'Online <span class="grad">BP</span>',
    heroTitle2En: 'Captain draft · Map veto',
    pageTitles: {},
    pageTitlesEn: {},
    githubUrl: '',
    githubLabel: 'GitHub'
  }, CSBP.SiteConfig || {});

  function T(zh, en) {
    return CSBP.I18n.L(zh, en);
  }

  function isZh() {
    return CSBP.I18n.isZh();
  }

  function gameName(game) {
    if (!game) return '';
    return isZh() ? (game.nameZh || game.name) : game.name;
  }

  function mapName(map) {
    return isZh() ? map.cn : map.en;
  }

  // 中文模式在地图主名称下方补充英文名；英文模式不再重复显示中文
  function mapSub(map) {
    return isZh() && map.en !== map.cn ? map.en : '';
  }

  // 浏览器标题随所选游戏切换
  function applyTitle(gameId) {
    var game = gameId ? CSBP.Games.get(gameId) : null;
    var titles = (isZh() ? SITE.pageTitles : (SITE.pageTitlesEn || SITE.pageTitles)) || {};
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
        img.alt = T(SITE.brandText || 'Logo', SITE.brandTextEn || SITE.brandText || 'Logo');
        mark.textContent = '';
        mark.appendChild(img);
        mark.classList.add('has-logo');
      } else {
        mark.textContent = SITE.brandMark;
        mark.classList.remove('has-logo');
      }
    }
    var brand = document.querySelector('[data-site="brand-text"]');
    if (brand) brand.textContent = T(SITE.brandText, SITE.brandTextEn || SITE.brandText);

    var desc = document.getElementById('metaDescription');
    if (desc) {
      desc.setAttribute('content', T(
        'CS2 / VALORANT 自定义 BP 工具：在线房间或单机模式，配置图池、随机队长、蛇形选人、BO1/BO3/BO5 地图 BP，一键复制战报。',
        'CS2 / VALORANT BanPick tool: online rooms or offline mode, map pools, random captains, snake draft, BO1/BO3/BO5 map veto, one-click report.'));
    }

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

  // 切换语言后同步静态 HTML 文案、品牌与标题
  function applyStaticText() {
    CSBP.I18n.applyStatic();
    applySiteConfig();
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

  // 图池开局校验：所有赛制（BO1 / BO3 / BO5）都必须恰好 7 张
  function poolProblem(s) {
    var count = s.config.pool.length;
    if (count === 7) return '';
    return T('图池必须恰好 7 张地图才能开始 BP（当前 ' + count + ' 张）',
      'The map pool must contain exactly 7 maps to start (currently ' + count + ')');
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
      ? T('连接已断开', 'Disconnected')
      : (info.localOnly
        ? (info.connected ? T('本机联机', 'Local multi-tab') : T('等待本机标签加入', 'Waiting for local tab'))
        : (info.connected ? T('已连接', 'Connected') : (info.mode === 'host' ? T('等待加入', 'Waiting for players') : T('连接中', 'Connecting'))));
    var role = info.mode === 'guest'
      ? (info.side ? T(info.side + ' 队长', 'Team ' + info.side + ' captain') : T('观战', 'Spectator')) + ' · '
      : '';
    return '<span class="head-meta online-pill' + (disconnected ? ' is-offline' : '') +
      '"><span class="online-dot"></span>' + T('房间 ', 'Room ') + esc(info.code) + ' · ' + role + stateText + '</span>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function playerName(s, idx) {
    if (idx === null || idx === undefined) return '—';
    return s.players[idx] || T('选手 ' + (idx + 1), 'Player ' + (idx + 1));
  }

  function capName(s, side) {
    if (!s.captains || s.captains[side] === undefined) return '—';
    return playerName(s, s.captains[side]);
  }

  function sideToggle(field, value, disabled) {
    var options = [['random', T('随机', 'Random')], ['A', T('A 队', 'Team A')], ['B', T('B 队', 'Team B')]];
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
        <div class="join-head"><b>${T('加入房间', 'Join a room')}</b></div>
        <div class="join-row">
          <input id="joinCode" class="join-input" maxlength="5" placeholder="ABCDE" value="${esc(joinCodeValue)}"
            autocomplete="off" spellcheck="false" ${joiningRoom ? 'disabled' : ''} />
          <button class="btn primary" data-action="join-online" ${joiningRoom ? 'disabled' : ''}>${joiningRoom ? T('连接中…', 'Connecting…') : T('加入', 'Join')}</button>
          <button class="btn ghost sm" data-action="hide-join" ${joiningRoom ? 'disabled' : ''}>${T('取消', 'Cancel')}</button>
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
        '<span class="gc-name">' + esc(gameName(g)) + '</span>' +
        '<span class="gc-check" aria-hidden="true">✓</span>' +
        '</button>';
    }).join('');
  }

  function viewHome() {
    var supported = Net.supported();
    var game = CSBP.Games.get(Store.state.config.game);
    var heroTitles = isZh() ? SITE.heroTitles : (SITE.heroTitlesEn || SITE.heroTitles);
    var titles;
    if (game) {
      titles = (heroTitles && heroTitles[game.id]) ||
        [T(SITE.heroTitle1, SITE.heroTitle1En || SITE.heroTitle1),
          T(SITE.heroTitle2, SITE.heroTitle2En || SITE.heroTitle2)];
    } else {
      titles = (isZh() ? SITE.heroTitleNone : (SITE.heroTitleNoneEn || SITE.heroTitleNone)) ||
        [T('在线 <span class="grad">BanPick</span>', 'Online <span class="grad">BanPick</span>'),
          T('选择游戏开始', 'Pick a game to start')];
    }
    return `
    <section class="view home-view">
      <div class="hero">
        <h1>${titles[0]}<br />${titles[1]}</h1>
        <div class="game-picker" role="group" aria-label="${T('选择游戏', 'Choose a game')}">${gamePicker()}</div>
        ${game ? `
        <div class="hero-actions">
          <button class="btn primary lg" data-action="create-online" ${creatingRoom || !supported ? 'disabled' : ''}>${creatingRoom ? T('创建中…', 'Creating…') : T('创建在线房间', 'Create online room')} <span class="arrow">→</span></button>
          <button class="btn ghost lg" data-action="show-join" ${joiningRoom || !supported ? 'disabled' : ''}>${T('加入房间', 'Join a room')}</button>
          <button class="btn link lg" data-action="enter-lobby">${T('单机模式', 'Offline mode')}</button>
        </div>
        ${!supported ? '<p class="hint warn-text">' + T('联机组件加载失败，请刷新页面或检查网络；单机模式仍可正常使用。', 'Online components failed to load. Refresh the page or check your network; offline mode still works.') + '</p>' : ''}
        ${joinOpen ? joinPanel() : ''}` : ''}
      </div>
    </section>`;
  }

  function roomBar() {
    var info = Net.info();
    if (info.mode === 'local') return '';
    var host = info.mode === 'host';
    var statusText = disconnected
      ? T('连接已断开，仅可查看', 'Disconnected — view only')
      : (info.localOnly
        ? (info.connected ? T('本机联机 · 仅同一浏览器标签', 'Local multi-tab · same browser only') : T('等待同一浏览器的队长标签加入…', 'Waiting for captain tabs in this browser…'))
        : (info.connected ? T('已连接', 'Connected') : (host ? T('等待队长加入…', 'Waiting for captains…') : T('正在同步房间…', 'Syncing room…'))));

    var sideChips = '';
    if (host) {
      sideChips = '<div class="rb-sides">' + ['A', 'B'].map(function (side) {
        var linked = info.sides[side];
        return '<span class="rb-side side-' + side.toLowerCase() + (linked ? ' on' : '') + '">' +
          '<i></i>TEAM ' + side + (linked ? T(' 已连接', ' connected') : T(' 等待', ' waiting')) + '</span>';
      }).join('') + '</div>';
    } else {
      sideChips = '<span class="rb-role">' + (info.side ? T(info.side + ' 队长', 'Team ' + info.side + ' captain') : T('观战模式', 'Spectator mode')) + '</span>';
    }

    var copyBtns = host && Store.state.captains
      ? '<button class="btn tiny" data-action="copy-captain-link" data-side="A">' + T('复制 A 链接', 'Copy A link') + '</button>' +
        '<button class="btn tiny" data-action="copy-captain-link" data-side="B">' + T('复制 B 链接', 'Copy B link') + '</button>'
      : '';

    return `
      <div class="room-bar ${info.connected ? 'is-connected' : ''}${disconnected ? ' is-offline' : ''}">
        <div class="rb-left">
          <span class="rb-label">${T('房间码', 'Room code')}</span>
          <b class="rb-code">${esc(info.code)}</b>
          ${sideChips}
        </div>
        <div class="rb-status"><i></i>${statusText}</div>
        ${copyBtns}
        <button class="btn tiny ghost" data-action="leave-room">${host ? T('关闭房间', 'Close room') : T('离开房间', 'Leave room')}</button>
      </div>`;
  }

  function manualPanel(s) {
    function options(selected) {
      var html = '<option value="-1">' + T('请选择选手', 'Select a player') + '</option>';
      s.players.forEach(function (p, i) {
        html += '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' +
          (i + 1) + '. ' + esc(p || T('空位', 'Empty')) + '</option>';
      });
      return html;
    }
    return `
      <div class="manual-panel">
        <div class="panel-head">
          <h3>${T('手动指定队长', 'Assign captains manually')}</h3>
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
          <button class="btn primary sm" data-action="confirm-manual-captains">${T('确认队长', 'Confirm captains')}</button>
          <button class="btn ghost sm" data-action="toggle-manual">${T('取消', 'Cancel')}</button>
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
        <div><h2>${T('房间配置', 'Room Setup')}</h2></div>
        <div class="head-actions">
          <span class="head-meta">${esc(CSBP.CurrentGame.label)}</span>
          <button class="btn ghost sm" data-action="go-home">${T('返回首页', 'Back to home')}</button>
        </div>
      </div>
      ${roomBar()}
      <div class="lobby-grid">
        <div class="panel">
          <div class="panel-head"><h3>${T('赛制', 'Series')}</h3></div>
          <div class="segmented">
            ${[1, 3, 5].map(function (n) {
              return '<button class="seg ' + (s.config.series === n ? 'active' : '') +
                '" data-action="set-series" data-series="' + n + '"' + (guest ? ' disabled' : '') + '>BO' + n + '</button>';
            }).join('')}
          </div>

          <div class="panel-head spaced">
            <h3>${T('组队方式', 'Team setup')}</h3>
          </div>
          <div class="segmented">
            <button class="seg ${randomMode ? '' : 'active'}" data-action="set-mode" data-mode="draft"${guest ? ' disabled' : ''}>${T('队长选人', 'Captain draft')}</button>
            <button class="seg ${randomMode ? 'active' : ''}" data-action="set-mode" data-mode="random"${guest ? ' disabled' : ''}>${T('随机分组', 'Random split')}</button>
          </div>

          <div class="panel-head spaced">
            <h3>${T('地图池', 'Map pool')}</h3>
            <span class="count ${count !== 7 ? 'warn' : ''}">${count} ${T('张', 'maps')}</span>
          </div>
          <div class="pool-tools">
            <button class="btn tiny${s.config.poolMode === 'active' ? ' primary' : ''}" data-action="preset-pool" data-preset="active" ${guest ? 'disabled' : ''}>${T('现役七图', 'Active pool')}</button>
            <button class="btn tiny${s.config.poolMode === 'all' ? ' primary' : ''}" data-action="preset-pool" data-preset="all" ${guest ? 'disabled' : ''}>${T('全部地图', 'All maps')}</button>
          </div>
          <div class="map-select-grid">
            ${(s.config.poolMode === 'all' ? CSBP.Maps.MAPS : CSBP.ActiveMaps.list()).map(function (m) {
              var on = s.config.pool.indexOf(m.id) >= 0;
              var sub = mapSub(m);
              return '<button class="map-tile ' + (on ? 'on' : '') + '" data-action="toggle-map" data-map="' + m.id +
                '" style="--h:' + m.hue + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
                (guest ? ' disabled' : '') + '>' +
                '<span class="mt-cn">' + esc(mapName(m)) + '</span>' +
                (sub ? '<span class="mt-en">' + esc(sub) + '</span>' : '') +
                '<span class="mt-check">✓</span>' +
                '</button>';
            }).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>${T('选手名单', 'Players')}</h3></div>
          <div class="player-inputs">
            ${s.players.map(function (p, i) {
              return '<label class="player-input' + (guest ? ' is-readonly' : '') + '">' +
                '<span class="pi-no">' + String(i + 1).padStart(2, '0') + '</span>' +
                '<input data-player="' + i + '" value="' + esc(p) + '" maxlength="24" placeholder="' + T('选手 ID / 昵称', 'Player ID / nickname') + '" ' +
                'autocomplete="off" spellcheck="false"' + (guest ? ' readonly' : '') + ' />' +
                '</label>';
            }).join('')}
          </div>

          <div class="panel-head spaced"><h3>${T('先手设置', 'First pick')}</h3></div>
          <div class="setting-row"><span>${T('Roll 点定先手', 'Roll for first pick')}</span>
            <div class="segmented mini">
              <button class="seg ${s.config.rollFirst ? '' : 'active'}" data-action="set-roll-first" data-value="off"${guest ? ' disabled' : ''}>${T('关闭', 'Off')}</button>
              <button class="seg ${s.config.rollFirst ? 'active' : ''}" data-action="set-roll-first" data-value="on"${guest ? ' disabled' : ''}>${T('开启', 'On')}</button>
            </div>
          </div>
          ${s.config.rollFirst
            ? ''
            : (randomMode
              ? '<div class="setting-row"><span>' + T('地图 BP 先手', 'Map BP first') + '</span>' + sideToggle('bpFirst', s.config.bpFirst, guest) + '</div>'
              : '<div class="setting-row"><span>' + T('选人先手', 'Draft first') + '</span>' + sideToggle('draftFirst', s.config.draftFirst, guest) + '</div>' +
                '<div class="setting-row"><span>' + T('地图 BP 先手', 'Map BP first') + '</span>' + sideToggle('bpFirst', s.config.bpFirst, guest) + '</div>')}

          <div class="lobby-cta">
            ${randomMode
              ? '<button class="btn primary block" data-action="random-split" ' + (guest ? 'disabled' : '') + '>' +
                  (guest ? T('等待房主开始', 'Waiting for host') : T('随机分组', 'Random split') + ' <span class="arrow">→</span>') + '</button>'
              : '<button class="btn primary block" data-action="roll-captains" ' + (guest ? 'disabled' : '') + '>' +
                  (guest ? T('等待房主开始', 'Waiting for host') : T('随机队长', 'Draw captains') + ' <span class="arrow">→</span>') + '</button>' +
                '<button class="btn ghost block" data-action="toggle-manual" ' + (guest ? 'disabled' : '') + '>' + T('手动指定队长', 'Assign captains manually') + '</button>'}
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
      var label = info.side ? T('你是 ' + info.side + ' 队长', 'You are the Team ' + info.side + ' captain') : T('你是观战者', 'You are a spectator');
      var desc = info.side
        ? T('只能为 ' + info.side + ' 队选人、在 ' + info.side + ' 队的回合 BP，并负责本队相关选边。',
          'You can only draft for Team ' + info.side + ', act on Team ' + info.side + '\'s BP turns, and pick sides for your team.')
        : T('只能查看，无法参与选人、地图 BP 与选边。', 'View only. You cannot draft, ban/pick maps, or choose sides.');
      return '<div class="identity-panel side-' + (info.side ? info.side.toLowerCase() : 'x') + '">' +
        '<b>' + label + '</b><span>' + desc + '</span></div>';
    }
    if (info.mode !== 'host') return '';
    return `
      <div class="link-panel">
        <div class="panel-head"><h3>${T('队长专属链接', 'Captain links')}</h3><span class="hint">${T('链接按队伍区分，互相不能代选', 'Each link is team-specific and cannot act for the other team')}</span></div>
        ${['A', 'B'].map(function (side) {
          var url = Net.inviteUrl(side);
          var linked = info.sides[side];
          return '<div class="link-row side-' + side.toLowerCase() + '">' +
            '<span class="link-side">TEAM ' + side + '</span>' +
            '<code class="link-url">' + esc(url) + '</code>' +
            '<span class="link-state' + (linked ? ' on' : '') + '">' + (linked ? T('已连接', 'Connected') : T('等待加入', 'Waiting')) + '</span>' +
            '<button class="btn tiny" data-action="copy-captain-link" data-side="' + side + '"' +
            (url ? '' : ' disabled') + '>' + T('复制链接', 'Copy link') + '</button>' +
            '</div>';
        }).join('')}
      </div>`;
  }

  function rosterCard(s, side) {
    var picks = s.draft.picks.filter(function (p) { return p.side === side; });
    var cap = s.captains ? s.captains[side] : null;
    return '<div class="team-col side-' + side.toLowerCase() + ' roster-card">' +
      '<div class="tc-head"><span class="team-tag">TEAM ' + side + '</span>' +
      '<b>' + esc(capName(s, side)) + '</b><span class="tc-role">' + T('队长', 'Captain') + '</span></div>' +
      '<ul class="roster">' +
      picks.map(function (p, i) {
        var isCap = cap === p.player;
        return '<li class="filled' + (isCap ? ' is-cap' : '') + '">' +
          '<span class="slot-no">' + (i + 1) + '</span>' +
          '<span class="slot-name">' + esc(playerName(s, p.player)) + '</span>' +
          (isCap ? '<span class="slot-cap">' + T('队长', 'Captain') + '</span>' : '') +
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
      var foot = winner === side
        ? T('先选人', 'Picks first')
        : (done ? T('后选人', 'Picks second') : (has ? T('已 Roll 点', 'Rolled') : T('待 Roll 点', 'Not rolled')));
      return '<div class="' + cls + '">' +
        '<span class="team-tag">TEAM ' + side + '</span>' +
        '<b class="roll-value" data-roll-value="' + side + '">' + (has ? roll[side] : '--') + '</b>' +
        '<span class="roll-foot">' + foot + '</span>' +
        '</div>';
    }

    var actions;
    if (guest) {
      if (!mySide) {
        actions = '<span class="hint">' + T('观战模式，等待两位队长自行 Roll 点', 'Spectator mode — waiting for both captains to roll') + '</span>';
      } else if (roll[mySide] !== null && roll[mySide] !== undefined) {
        actions = '<span class="hint">' + T('你已 Roll 出 ' + roll[mySide] + ' 点，等待对手', 'You rolled ' + roll[mySide] + '. Waiting for your opponent') + '</span>';
      } else {
        actions = '<button class="btn primary sm" data-action="roll-first"' +
          (rollAnimating || disconnected ? ' disabled' : '') + '>' + T('ROLL 点', 'ROLL') + '</button>';
      }
    } else if (isOnline()) {
      var waiting = [];
      if (roll.A === null || roll.A === undefined) waiting.push('A');
      if (roll.B === null || roll.B === undefined) waiting.push('B');
      actions = waiting.length
        ? '<span class="hint">' + T('等待 ' + waiting.join(' / ') + ' 队长在自己的设备上 Roll 点', 'Waiting for Team ' + waiting.join(' / ') + ' to roll on their own device') + '</span>'
        : '<span class="hint">' + T('两位队长均已 Roll 点，3 秒后自动继续', 'Both captains have rolled — continuing in 3 seconds') + '</span>';
    } else {
      var hasAny = (roll.A !== null && roll.A !== undefined) || (roll.B !== null && roll.B !== undefined);
      actions = '<button class="btn primary sm" data-action="roll-first"' + (rollAnimating ? ' disabled' : '') + '>' +
        (hasAny ? T('重新 Roll 点', 'Roll again') : T('开始 Roll 点', 'Start rolling')) + '</button>' +
        (done ? '<span class="hint">' + T('3 秒后自动进入下一步', 'Continuing automatically in 3 seconds') + '</span>' : '');
    }

    return '<div class="roll-panel">' +
      '<div class="panel-head"><h3>' + T('Roll 点决定先手', 'Roll for first pick') + '</h3></div>' +
      '<div class="roll-stage">' + card('A') + '<span class="roll-vs">VS</span>' + card('B') + '</div>' +
      '<div class="roll-actions">' + actions +
      (winner ? '<span class="roll-result">' + T('队伍 ' + winner + ' 先选人', 'Team ' + winner + ' picks first') + '</span>' : '') +
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
        <div><h2>${random ? T('随机分组', 'Random Split') : T('队长确定', 'Captains')}</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <button class="btn ghost sm" data-action="back-lobby">${T('返回配置', 'Back to setup')}</button>
        </div>
      </div>

      ${captainLinksPanel(s)}

      <div class="captain-stage">
        <div class="captain-card side-a ${capA ? 'revealed' : ''} ${rolling ? 'rolling' : ''}">
          <span class="team-tag">TEAM A</span>
          <div class="cap-name">${capA ? esc(capA) : '？？？'}</div>
          ${capA ? '' : '<span class="cap-foot">' + T('抽取中…', 'Drawing…') + '</span>'}
        </div>
        <div class="vs-badge">VS</div>
        <div class="captain-card side-b ${capB ? 'revealed' : ''} ${rolling ? 'rolling' : ''}">
          <span class="team-tag">TEAM B</span>
          <div class="cap-name">${capB ? esc(capB) : '？？？'}</div>
          ${capB ? '' : '<span class="cap-foot">' + T('抽取中…', 'Drawing…') + '</span>'}
        </div>
      </div>

      ${rollPanel(s)}

      ${random
        ? '<div class="roster-grid">' + rosterCard(s, 'A') + rosterCard(s, 'B') + '</div>'
        : `<div class="panel">
        <div class="panel-head"><h3>${T('选手池', 'Player pool')}</h3></div>
        <div class="player-grid">
          ${s.players.map(function (p, i) {
            var isA = s.captains && s.captains.A === i;
            var isB = s.captains && s.captains.B === i;
            var cls = 'player-chip';
            if (isA) cls += ' cap-a';
            if (isB) cls += ' cap-b';
            return '<div class="' + cls + '"><span class="pc-name">' + esc(p || T('空位', 'Empty')) + '</span>' +
              (isA ? '<span class="pc-badge a">A</span>' : '') +
              (isB ? '<span class="pc-badge b">B</span>' : '') +
              '</div>';
          }).join('')}
        </div>
      </div>`}

      <div class="actions">
        ${random
          ? '<button class="btn ghost" data-action="random-split" ' + ((rolling || isGuest()) ? 'disabled' : '') + '>' + T('重新分组', 'Re-split') + '</button>' +
            '<button class="btn primary" data-action="start-mapbp" ' + ((!s.captains || rolling || isGuest() || needRoll) ? 'disabled' : '') + '>' + T('开始地图 BP', 'Start map ban/pick') + ' <span class="arrow">→</span></button>'
          : '<button class="btn ghost" data-action="roll-captains" ' + ((rolling || isGuest()) ? 'disabled' : '') + '>' + T('重新抽取', 'Draw again') + '</button>' +
            '<button class="btn primary" data-action="start-draft" ' + ((!s.captains || rolling || isGuest() || needRoll) ? 'disabled' : '') + '>' + T('开始选人', 'Start draft') + ' <span class="arrow">→</span></button>'}
        ${needRoll ? '<span class="hint">' + T('请先完成 Roll 点', 'Finish the roll-off first') + '</span>' : ''}
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
          '<span class="slot-name">' + (p ? esc(playerName(s, p.player)) : T('待选择', 'Open')) + '</span>' +
          '</li>';
      }
      return '<aside class="team-col side-' + side.toLowerCase() + '">' +
        '<div class="tc-head"><span class="team-tag">TEAM ' + side + '</span>' +
        '<b>' + esc(capName(s, side)) + '</b><span class="tc-role">' + T('队长', 'Captain') + '</span></div>' +
        '<ul class="roster">' + slots + '</ul>' +
        '</aside>';
    }

    return `
    <section class="view">
      <div class="view-head">
        <div><h2>${T('队长选人', 'Captain Draft')}</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <span class="head-meta">${T('第 ' + Math.min(done + 1, total) + ' / ' + total + ' 手', 'Pick ' + Math.min(done + 1, total) + ' / ' + total)}</span>
        </div>
      </div>

      <div class="turn-banner side-${currentSide ? currentSide.toLowerCase() : 'a'}">
        <span class="turn-dot"></span>
        ${currentSide
          ? '<b>' + T('队伍 ' + currentSide, 'Team ' + currentSide) + '</b><span>' + esc(capName(s, currentSide)) + T(' 选人', ' is picking') + '</span>'
          : '<b>' + T('选人完成', 'Draft complete') + '</b>' + (isGuest() ? '<span>' + T('等待房主', 'Waiting for host') + '</span>' : '')}
        ${isGuest()
          ? '<span class="turn-role">' + (mySide ? T('你是 ' + mySide + ' 队长', 'You are the Team ' + mySide + ' captain') : T('观战模式', 'Spectator mode')) +
            (canAct ? T(' · 轮到你操作', ' · Your turn') : T(' · 等待对方', ' · Waiting for the other team')) + '</span>'
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
            <div class="panel-head"><h3>${T('可选选手', 'Available players')}</h3></div>
            <div class="player-grid draft-pool">
              ${available.length
                ? available.map(function (idx) {
                    return '<button class="player-chip pickable side-' + (currentSide ? currentSide.toLowerCase() : 'a') +
                      '" data-action="pick-player" data-index="' + idx + '"' +
                      (canAct ? '' : ' disabled') + '>' + esc(playerName(s, idx)) + '</button>';
                  }).join('')
                : '<p class="empty">' + T('所有选手都已选完', 'All players have been drafted') + '</p>'}
            </div>
          </div>
          ${isDone
            ? '<div class="actions">' + (isGuest()
                ? '<span class="hint">' + T('等待房主', 'Waiting for host') + '</span>'
                : '<button class="btn primary" data-action="finish-draft">' + T('进入下一步', 'Continue') + ' <span class="arrow">→</span></button>') +
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
            return '<span class="bpt-map" style="--h:' + m.hue + '">' + esc(mapName(m)) + sideTag + '</span>';
          }).join('')
        : '<span class="bpt-empty">' + T('尚未选图', 'No maps yet') + '</span>') +
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
      '<b>' + esc(mapName(map)) + '</b>' +
      '<span class="sp-kind">' + (pending.kind === 'decider' ? T('决胜图选边', 'Decider side') : T('地图选边', 'Map side')) + '</span></div>' +
      '<div class="sp-actions">' +
      '<button class="btn side-btn ct" data-action="choose-side" data-value="CT"' + (canSide ? '' : ' disabled') + '>' + T('CT · 防守方', 'CT · Defense') + '</button>' +
      '<button class="btn side-btn t" data-action="choose-side" data-value="T"' + (canSide ? '' : ' disabled') + '>' + T('T · 进攻方', 'T · Attack') + '</button>' +
      '</div>' +
      (isGuest() && !canSide ? '<span class="hint">' + T('等待 ' + pending.side + ' 队长选边', 'Waiting for Team ' + pending.side + ' captain to pick a side') + '</span>' : '') +
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
        <div><h2>${T('BAN 顺序', 'Ban Order')}</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <span class="head-meta">BO${s.config.series} · ${T('图池', 'Pool')} ${s.config.pool.length} ${T('张', 'maps')}</span>
        </div>
      </div>

      <div class="roll-panel">
        <div class="panel-head"><h3>${T('Roll 点结果', 'Roll result')}</h3></div>
        <div class="roll-stage">
          <div class="roll-card side-a ${winner === 'A' ? 'winner' : ''}">
            <span class="team-tag">TEAM A</span>
            <b class="roll-value">${roll ? roll.A : '--'}</b>
            <span class="roll-foot">${winner === 'A' ? T('决定顺序', 'Sets order') : T('等待', 'Waiting')}</span>
          </div>
          <span class="roll-vs">VS</span>
          <div class="roll-card side-b ${winner === 'B' ? 'winner' : ''}">
            <span class="team-tag">TEAM B</span>
            <b class="roll-value">${roll ? roll.B : '--'}</b>
            <span class="roll-foot">${winner === 'B' ? T('决定顺序', 'Sets order') : T('等待', 'Waiting')}</span>
          </div>
        </div>
      </div>

      <div class="order-panel side-${winner ? winner.toLowerCase() : 'a'}">
        <div class="panel-head"><h3>${T('选择 BAN 顺序', 'Choose ban order')}</h3>${winner ? '<span class="head-meta">TEAM ' + winner + '</span>' : ''}</div>
        <div class="order-stage">
          <button class="order-card" data-action="choose-order" data-first="1"${canAct ? '' : ' disabled'}>
            <b>${T('先 BAN 图', 'Ban first')}</b>
          </button>
          <button class="order-card" data-action="choose-order" data-first="0"${canAct ? '' : ' disabled'}>
            <b>${T('后 BAN 图', 'Ban second')}</b>
          </button>
        </div>
        ${isGuest() && !canAct ? '<p class="hint center">' + T('等待 ' + (winner || '') + ' 队长选择', 'Waiting for Team ' + (winner || '') + ' captain to choose') + '</p>' : ''}
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
        <div><h2>${T('地图 BP', 'Map Ban/Pick')}</h2></div>
        <div class="head-actions">
          ${roomPill()}
          <span class="head-meta">BO${s.config.series} · ${T('图池', 'Pool')} ${s.config.pool.length} ${T('张', 'maps')}</span>
        </div>
      </div>

      ${pending ? '<div class="turn-banner side-' + pending.side.toLowerCase() + '">' +
          '<span class="turn-dot"></span><b>' + T('队伍 ' + pending.side, 'Team ' + pending.side) + '</b>' +
          '<span>' + T('选择「' + esc(mapName(pendingMap)) + '」的起始阵营', 'Choose the starting side on ' + esc(mapName(pendingMap))) + '</span>' +
          '<span class="turn-progress">' + (pending.kind === 'decider' ? T('决胜图选边', 'Decider side') : T('地图选边', 'Map side')) + '</span>' +
          (isGuest()
            ? '<span class="turn-role">' + (mySide ? T('你是 ' + mySide + ' 队长', 'You are the Team ' + mySide + ' captain') : T('观战模式', 'Spectator mode')) +
              (canSide ? T(' · 轮到你选边', ' · Your turn to pick a side') : T(' · 等待对方', ' · Waiting for the other team')) + '</span>'
            : '') +
          '</div>'
        : (step ? '<div class="turn-banner side-' + step.side.toLowerCase() + '">' +
          '<span class="turn-dot"></span><b>' + T('队伍 ' + step.side, 'Team ' + step.side) + '</b>' +
          '<span>' + (step.type === 'ban' ? T('BAN 一张地图', 'Ban a map') : T('PICK 一张地图', 'Pick a map')) + '</span>' +
          '<span class="turn-progress">' + T('第 ' + (stepIdx + 1) + ' / ' + s.mapbp.steps.length + ' 步', 'Step ' + (stepIdx + 1) + ' / ' + s.mapbp.steps.length) + '</span>' +
          (isGuest()
            ? '<span class="turn-role">' + (mySide ? T('你是 ' + mySide + ' 队长', 'You are the Team ' + mySide + ' captain') : T('观战模式', 'Spectator mode')) +
              (canAct ? T(' · 轮到你操作', ' · Your turn') : T(' · 等待对方', ' · Waiting for the other team')) + '</span>'
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
            '<span class="bps-map">' + (map ? esc(mapName(map)) + sideTag : (i === stepIdx ? T('进行中', 'In progress') : '—')) + '</span>' +
            '</div>';
        }).join('')}
      </div>

      <div class="bp-layout">
        <div class="panel bp-panel">
          <div class="panel-head"><h3>${T('选择地图', 'Choose a map')}</h3></div>
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
                '<span class="map-info"><b>' + esc(mapName(m)) + '</b>' + (mapSub(m) ? '<i>' + esc(mapSub(m)) + '</i>' : '') + '</span>' +
                label +
                '</button>';
            }).join('')}
          </div>
        </div>

        <aside class="bp-side">
          ${teamPicksCard('A', s, pickedA)}
          ${teamPicksCard('B', s, pickedB)}
          <div class="decider-card">
            <span class="dc-label">${s.config.series === 1 ? T('比赛地图', 'Match map') : T('决胜图', 'Decider')}</span>
            <b>${decider ? esc(mapName(CSBP.Maps.get(decider))) : T('待定', 'TBD')}</b>
            <span class="dc-en">${decider
              ? esc(mapSub(CSBP.Maps.get(decider)) || CSBP.Maps.get(decider).en) +
                (deciderSide ? T(' · 选边 ' + deciderSide, ' · Side ' + deciderSide) : (pending && pending.kind === 'decider' ? T(' · 选边中', ' · Picking side') : ''))
              : T('剩余 ' + remaining.length + ' 张图', remaining.length + ' maps left')}</span>
          </div>
        </aside>
      </div>
    </section>`;
  }

  function resultTeamCard(side, s) {
    var picks = s.draft.picks.filter(function (p) { return p.side === side; });
    return '<div class="result-team side-' + side.toLowerCase() + '">' +
      '<div class="rt-head"><span class="team-tag">TEAM ' + side + '</span>' +
      '<b>' + esc(capName(s, side)) + '</b><span class="rt-role">' + T('队长', 'Captain') + '</span></div>' +
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
        <h2>${T('BP 完成', 'BP Complete')}</h2>
      </div>

      <div class="result-teams">
        ${resultTeamCard('A', s)}
        ${resultTeamCard('B', s)}
      </div>

      <div class="panel result-maps">
        <div class="panel-head">
          <h3>${T('比赛地图', 'Match maps')}</h3>
        </div>
        <ol class="map-order">
          ${maps.map(function (item, i) {
            var map = CSBP.Maps.get(item.mapId);
            var side = s.mapbp.sides[item.mapId];
            var tag = item.type === 'decider'
              ? (s.config.series === 1 ? T('比赛地图', 'Match map') : T('决胜图', 'Decider'))
              : T(item.side + ' 队选', 'Team ' + item.side + ' pick');
            if (side) tag += T(' · 选边 ' + side, ' · Side ' + side);
            var cls = item.type === 'decider' ? 'decider' : 'picked side-' + item.side.toLowerCase();
            return '<li class="' + cls + '">' +
              '<span class="mo-no">' + (i + 1) + '</span>' +
              '<span class="mo-art" style="--h:' + map.hue + '"></span>' +
              '<span class="mo-name"><b>' + esc(mapName(map)) + '</b>' + (mapSub(map) ? '<i>' + esc(mapSub(map)) + '</i>' : '') + '</span>' +
              '<span class="mo-tag">' + tag + '</span>' +
              '</li>';
          }).join('')}
        </ol>
      </div>

      <div class="actions">
        <button class="btn primary" data-action="copy-report">${T('复制战报', 'Copy report')}</button>
        ${guest
          ? '<button class="btn ghost" data-action="leave-room">' + T('离开房间', 'Leave room') + '</button>'
          : '<button class="btn ghost" data-action="again">' + T('再来一局', 'Play again') + '</button><button class="btn ghost" data-action="back-lobby">' + T('返回大厅', 'Back to lobby') + '</button><button class="btn danger-ghost" data-action="reset-all">' + T('清空重开', 'Reset') + '</button>'}
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
      var label = (config.mode === 'random' && st.key === 'captains')
        ? T('随机分组', 'Random Split')
        : T(st.label, st.labelEn);
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
      text.textContent = T('本地模式', 'Offline mode');
      tag.hidden = true;
      return;
    }
    tag.hidden = false;
    tag.classList.add('online');
    text.textContent = T('在线 · ', 'Online · ') + (info.mode === 'host'
      ? T('房主', 'Host')
      : (info.side ? T(info.side + ' 队长', 'Team ' + info.side + ' captain') : T('观战', 'Spectator')));
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
      toast(T('图池由房主统一设置', 'The host manages the map pool'), 'warn');
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
      toast(T('图池由房主统一设置', 'The host manages the map pool'), 'warn');
      return;
    }
    Store.setPoolMode(kind === 'all' ? 'all' : 'active');
    if (kind === 'all') {
      toast(T('已显示全部 ' + Store.state.config.pool.length + ' 张地图',
        'Showing all ' + Store.state.config.pool.length + ' maps'));
    } else {
      toast(T('已切换为现役七图', 'Switched to the active pool'));
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
      toast(T('随机队长由房主操作', 'Only the host can draw captains'), 'warn');
      return;
    }
    if (rolling) return;
    var s = Store.state;
    var missing = 0;
    s.players.forEach(function (p) { if (!String(p).trim()) missing += 1; });
    if (missing > 0) {
      toast(T('还有 ' + missing + ' 名选手未填写 ID', missing + ' player(s) still need an ID'));
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
      toast(T('两名队长已抽取', 'Both captains have been drawn'));
    }, 1700);
  }

  function doRollFirst() {
    if (rollAnimating) return;
    var s = Store.state;

    // 队长在自己的设备上 Roll 自己的点数
    if (isGuest()) {
      var side = Net.info().side;
      if (!Net.info().connected) {
        toast(T('正在等待与房主连接…', 'Waiting for the host connection…'), 'warn');
        return;
      }
      if (!side) {
        toast(T('观战模式，无法 Roll 点', 'Spectators cannot roll'), 'warn');
        return;
      }
      if (s.roll && s.roll[side] !== null && s.roll[side] !== undefined) {
        toast(T('你已完成 Roll 点', 'You have already rolled'), 'warn');
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
          toast(T('Roll 点发送失败，请稍后重试', 'Failed to send your roll. Try again'), 'warn');
          render();
          return;
        }
        toast(T('队伍 ' + side + ' Roll 出 ' + value + ' 点，等待对手',
          'Team ' + side + ' rolled ' + value + '. Waiting for your opponent'), 'ok');
        // 兜底：若长时间未收到房主同步则恢复按钮
        window.setTimeout(function () {
          var cur = Store.state.roll;
          if (!cur || cur[side] === null || cur[side] === undefined) render();
        }, 3000);
      }, 1100);
      return;
    }

    if (isOnline()) {
      toast(T('Roll 点由两位队长各自操作', 'Each captain rolls on their own device'), 'warn');
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
      toast(T('队伍 ' + winner + ' 先选人（Roll ' + a + ' : ' + b + '）',
        'Team ' + winner + ' picks first (Roll ' + a + ' : ' + b + ')'), 'ok');
    }, 1100);
  }

  function toggleManualCaptains() {
    if (isGuest()) {
      toast(T('队长由房主指定', 'Only the host can assign captains'), 'warn');
      return;
    }
    manualOpen = !manualOpen;
    render();
  }

  function confirmManualCaptains() {
    if (isGuest()) return;
    if (manualA < 0 || manualB < 0) {
      toast(T('请选择两名队长', 'Select two captains'), 'warn');
      return;
    }
    if (manualA === manualB) {
      toast(T('两名队长不能是同一名选手', 'The two captains must be different players'), 'warn');
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
    toast(T('队长已指定 / A：' + playerName(Store.state, manualA) +
      ' · B：' + playerName(Store.state, manualB),
    'Captains set / A: ' + playerName(Store.state, manualA) +
      ' · B: ' + playerName(Store.state, manualB)));
  }

  function startDraft() {
    if (isGuest()) {
      toast(T('由房主开始选人', 'Only the host can start the draft'), 'warn');
      return;
    }
    if (!Store.state.captains) {
      toast(T('请先抽取队长', 'Draw the captains first'));
      return;
    }
    if (Store.state.config.rollFirst && !rollDone(Store.state.roll)) {
      toast(T('请先完成 Roll 点决定先手', 'Finish the roll-off first'), 'warn');
      return;
    }
    var problem = poolProblem(Store.state);
    if (problem) {
      toast(problem, 'warn');
      return;
    }
    Store.startDraft();
    render();
    toast(T('选人开始：队伍 ' + Store.state.draft.first + ' 先选人',
      'Draft started: Team ' + Store.state.draft.first + ' picks first'));
  }

  function handleRandomSplit() {
    if (isGuest()) {
      toast(T('随机分组由房主操作', 'Only the host can split the teams'), 'warn');
      return;
    }
    if (rolling) return;
    var s = Store.state;
    var missing = 0;
    s.players.forEach(function (p) { if (!String(p).trim()) missing += 1; });
    if (missing > 0) {
      toast(T('还有 ' + missing + ' 名选手未填写 ID', missing + ' player(s) still need an ID'));
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
    toast(T('已随机分组', 'Teams split randomly'));
  }

  function startMapBP() {
    if (isGuest()) {
      toast(T('由房主开始地图 BP', 'Only the host can start map ban/pick'), 'warn');
      return;
    }
    if (!Store.state.captains) {
      toast(T('请先确定队伍', 'Set up the teams first'));
      return;
    }
    if (Store.state.config.rollFirst && !rollDone(Store.state.roll)) {
      toast(T('请先完成 Roll 点决定先手', 'Finish the roll-off first'), 'warn');
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
      toast(T('请由队伍 ' + winner + ' 选择先 BAN 或后 BAN',
        'Team ' + winner + ': choose to ban first or second'), 'ok');
    } else {
      toast(T('地图 BP 开始：队伍 ' + Store.state.mapbp.first + ' 先手',
        'Map ban/pick started: Team ' + Store.state.mapbp.first + ' goes first'));
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
      toast(T('选人完成，进入地图 BP', 'Draft complete. Starting map ban/pick'));
    } else if (Store.state.phase === 'order') {
      toast(T('选人完成，请由 Roll 胜者选择 BAN 顺序',
        'Draft complete. The roll winner chooses the ban order'));
    } else {
      toast(T('队伍 ' + side + ' 选中 ' + name, 'Team ' + side + ' picked ' + name));
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
      toast(T('队伍 ' + step.side + ' 选中 ' + mapName(map) + '，由队伍 ' +
        CSBP.Draft.flip(step.side) + ' 选边',
      'Team ' + step.side + ' picked ' + mapName(map) + '. Team ' +
        CSBP.Draft.flip(step.side) + ' chooses the side'));
    } else {
      toast(T('队伍 ' + step.side + ' BAN 掉 ' + mapName(map),
        'Team ' + step.side + ' banned ' + mapName(map)));
    }
    return true;
  }

  function commitOrder(first) {
    if (Store.state.phase !== 'order') return false;
    if (!Store.setBanOrder(first === true)) return false;
    render();
    toast(T('BAN 顺序已定：队伍 ' + Store.state.mapbp.first + ' 先 BAN',
      'Ban order set: Team ' + Store.state.mapbp.first + ' bans first'));
    return true;
  }

  function commitSide(value) {
    var pending = Store.state.mapbp.pending;
    if (!pending) return false;
    var map = CSBP.Maps.get(pending.mapId);
    if (!Store.bpSide(value)) return false;
    render();
    if (Store.state.phase === 'result') {
      toast(T('地图 BP 完成', 'Map ban/pick complete'));
    } else if (pending.kind === 'decider') {
      toast(T('决胜图 ' + mapName(map) + ' 由队伍 ' + pending.side + ' 选择 ' + value,
        'Decider ' + mapName(map) + ': Team ' + pending.side + ' chose ' + value));
    } else {
      toast(T('队伍 ' + pending.side + ' 为 ' + mapName(map) + ' 选择 ' + value,
        'Team ' + pending.side + ' chose ' + value + ' on ' + mapName(map)));
    }
    return true;
  }

  function handlePick(index) {
    if (disconnected) {
      toast(T('连接已断开，仅可查看', 'Disconnected — view only'), 'warn');
      return;
    }
    if (isGuest()) {
      if (!Net.info().connected) {
        toast(T('正在等待与房主连接…', 'Waiting for the host connection…'), 'warn');
        return;
      }
      if (!Net.info().side) {
        toast(T('观战模式，无法参与选人', 'Spectators cannot draft'), 'warn');
        return;
      }
      if (Net.info().side !== actingSide(Store.state)) {
        toast(T('还没轮到你们队选人', 'It is not your team\'s turn to pick'), 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'pick', index: index })) {
        toast(T('操作发送失败，请稍后重试', 'Failed to send the action. Try again'), 'warn');
      }
      return;
    }
    commitPick(index);
  }

  function handleBpAct(mapId) {
    if (disconnected) {
      toast(T('连接已断开，仅可查看', 'Disconnected — view only'), 'warn');
      return;
    }
    if (Store.state.mapbp.pending) {
      toast(T('请先完成当前选边', 'Finish the current side pick first'), 'warn');
      return;
    }
    if (isGuest()) {
      if (!Net.info().connected) {
        toast(T('正在等待与房主连接…', 'Waiting for the host connection…'), 'warn');
        return;
      }
      if (!Net.info().side) {
        toast(T('观战模式，无法进行地图 BP', 'Spectators cannot ban/pick maps'), 'warn');
        return;
      }
      if (Net.info().side !== actingSide(Store.state)) {
        toast(T('还没轮到你们队操作', 'It is not your team\'s turn'), 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'bp', mapId: mapId })) {
        toast(T('操作发送失败，请稍后重试', 'Failed to send the action. Try again'), 'warn');
      }
      return;
    }
    commitBp(mapId);
  }

  function handleOrder(first) {
    if (disconnected) {
      toast(T('连接已断开，仅可查看', 'Disconnected — view only'), 'warn');
      return;
    }
    if (isGuest()) {
      if (!Net.info().connected) {
        toast(T('正在等待与房主连接…', 'Waiting for the host connection…'), 'warn');
        return;
      }
      if (!Net.info().side) {
        toast(T('观战模式，无法选择 BAN 顺序', 'Spectators cannot choose the ban order'), 'warn');
        return;
      }
      if (Net.info().side !== rollWinner(Store.state)) {
        toast(T('只有 Roll 胜者可以选择 BAN 顺序', 'Only the roll winner can choose the ban order'), 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'order', first: first === true })) {
        toast(T('操作发送失败，请稍后重试', 'Failed to send the action. Try again'), 'warn');
      }
      return;
    }
    commitOrder(first);
  }

  function handleSide(value) {
    if (disconnected) {
      toast(T('连接已断开，仅可查看', 'Disconnected — view only'), 'warn');
      return;
    }
    var pending = Store.state.mapbp.pending;
    if (!pending) return;
    if (isGuest()) {
      if (!Net.info().connected) {
        toast(T('正在等待与房主连接…', 'Waiting for the host connection…'), 'warn');
        return;
      }
      if (!Net.info().side) {
        toast(T('观战模式，无法选边', 'Spectators cannot pick sides'), 'warn');
        return;
      }
      if (Net.info().side !== pending.side) {
        toast(T('由队伍 ' + pending.side + ' 选边', 'Team ' + pending.side + ' picks the side'), 'warn');
        return;
      }
      if (!Net.sendAction({ type: 'side', value: value })) {
        toast(T('操作发送失败，请稍后重试', 'Failed to send the action. Try again'), 'warn');
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
          toast(T('双方都 Roll 到 ' + nextRoll.A + ' 点，平局，请重新 Roll 点',
            'Both teams rolled ' + nextRoll.A + ' — tie. Roll again.'), 'warn');
        } else {
          var rollWin = nextRoll.A > nextRoll.B ? 'A' : 'B';
          toast(T('队伍 ' + rollWin + ' 先选人（Roll ' + nextRoll.A + ' : ' + nextRoll.B + '）',
            'Team ' + rollWin + ' picks first (Roll ' + nextRoll.A + ' : ' + nextRoll.B + ')'), 'ok');
        }
      } else {
        toast(T('队伍 ' + side + ' Roll 出 ' + value + ' 点',
          'Team ' + side + ' rolled ' + value), 'ok');
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
      if (s.captains) toast(T('两名队长已抽取', 'Both captains have been drawn'));
      return;
    }
    render();
  }

  function copyReport() {
    var text = CSBP.Share.buildReport(Store.state);
    CSBP.Share.copy(text).then(function (ok) {
      toast(ok
        ? T('战报已复制到剪贴板', 'Report copied to clipboard')
        : T('复制失败，请手动复制', 'Copy failed — please copy it manually'), ok ? 'ok' : 'warn');
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
      toast(T('请先创建在线房间', 'Create an online room first'), 'warn');
      return;
    }
    CSBP.Share.copy(url).then(function (ok) {
      if (ok) toast(T(side + ' 队长链接已复制', 'Team ' + side + ' captain link copied'), 'ok');
      else toast(T('复制失败，请手动复制：' + url, 'Copy failed — please copy it manually: ' + url), 'warn');
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
      toast(T('请先离开当前房间', 'Leave the current room first'), 'warn');
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
        toast(T('联机服务器不可用，已切换为本机联机：请在同一浏览器新标签打开队长链接',
          'The online server is unavailable, so local multi-tab mode is active. Open the captain links in new tabs of the same browser.'), 'warn');
      } else if (res.server === 'relay') {
        toast(T('房间已创建（本地信令），房间码 ' + res.code,
          'Room created (local signaling). Code: ' + res.code), 'ok');
      } else {
        toast(T('房间已创建，房间码 ' + res.code, 'Room created. Code: ' + res.code), 'ok');
      }
    }).catch(function (err) {
      creatingRoom = false;
      render();
      toast((err && err.message) || T('创建房间失败', 'Failed to create the room'), 'warn');
    });
  }

  function joinOnlineRoom(side, token) {
    if (joiningRoom) return;
    var code = Net.normalizeCode(joinCodeValue);
    if (code.length !== 5) {
      toast(T('请输入 5 位房间码', 'Enter a 5-character room code'), 'warn');
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
      var role = info.side
        ? T('身份：' + info.side + ' 队长', 'Role: Team ' + info.side + ' captain')
        : T('观战', 'Spectator');
      toast(info.localOnly
        ? T('已加入本机联机房间（' + role + '）', 'Joined the local multi-tab room (' + role + ')')
        : T('已加入房间，' + role, 'Joined the room. ' + role), 'ok');
    }).catch(function (err) {
      joiningRoom = false;
      render();
      toast((err && err.message) || T('加入房间失败', 'Failed to join the room'), 'warn');
    });
  }

  function leaveRoom() {
    if (!isOnline()) {
      Store.setPhase('home');
      render();
      return;
    }
    var guest = isGuest();
    if (!window.confirm(guest
      ? T('确定离开房间吗？', 'Leave this room?')
      : T('确定关闭房间吗？', 'Close this room?'))) return;
    Net.leave();
    clearRoomInUrl();
    resetRoomUi();
    if (guest) {
      Store.resetAll();
      lastPhase = null;
    }
    render();
    toast(guest
      ? T('已离开房间', 'Left the room')
      : T('房间已关闭，当前为单机模式', 'Room closed. Offline mode is active'), 'ok');
  }

  function exitToHome() {
    if (isOnline() && !window.confirm(isGuest()
      ? T('确定离开房间并返回首页吗？', 'Leave the room and return home?')
      : T('确定关闭房间并返回首页吗？', 'Close the room and return home?'))) {
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
    if (!window.confirm(T('确定清空全部本地数据并回到首页吗？', 'Clear all local data and return home?'))) return;
    rollToken += 1;
    rolling = false;
    Net.leave();
    clearRoomInUrl();
    resetRoomUi();
    Store.resetAll();
    lastPhase = null;
    render();
    toast(T('已清空所有数据', 'All data cleared'));
  }

  function requireGame() {
    if (Store.state.config.game) return true;
    toast(T('请先选择游戏', 'Choose a game first'), 'warn');
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
          toast(T('请先离开当前房间', 'Leave the current room first'), 'warn');
          return;
        }
        if (!requireGame()) return;
        Store.setPhase('lobby');
        render();
        break;
      case 'back-lobby':
        if (isGuest()) {
          toast(T('由房主返回大厅', 'Only the host can return to the lobby'), 'warn');
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
          toast(T('请由房主进入下一步', 'Only the host can continue'), 'warn');
          return;
        }
        if (Store.finishDraft()) {
          render();
          toast(T('选人完成，进入下一步', 'Draft complete. Continuing'));
        } else {
          toast(T('还有选手未选完', 'Some players have not been drafted yet'), 'warn');
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
          toast(T('由房主开始新一局', 'Only the host can start a new round'), 'warn');
          return;
        }
        manualOpen = false;
        Store.newRound();
        render();
        toast(T('已保留名单与配置，重新开始', 'Roster and settings kept. Starting over'));
        break;
      case 'reset-all':
        if (isGuest()) {
          toast(T('清空数据请先在房主端操作', 'Clear the data from the host device first'), 'warn');
          return;
        }
        resetAll();
        break;
      case 'set-lang':
        if (CSBP.I18n.setLang(el.getAttribute('data-lang'))) {
          applyStaticText();
          render();
        }
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
      if (side) toast(T(side + ' 队长已加入房间', 'Team ' + side + ' captain joined the room'), 'ok');
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
  applyStaticText();
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
  render();
})();
