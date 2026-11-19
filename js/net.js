(function () {
  'use strict';

  var CSBP = (window.CSBP = window.CSBP || {});

  var PREFIX = 'csbp-m2-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LEN = 5;
  var TOKEN_LEN = 12;

  var handlers = {};
  var mode = 'local';
  var code = null;
  var peer = null;
  var hostConns = [];      // 房主端：所有已绑定的连接
  var guestConn = null;    // 访客端：自己的连接
  var guestConnected = false;
  var guestSide = null;    // 访客身份 'A' | 'B' | null（观战）
  var getState = null;
  var sendTimer = null;
  var pendingSend = false;
  var session = 0;
  var tokens = { A: null, B: null };
  var transport = 'peer';  // 'peer'：PeerJS 联机；'local'：同一浏览器多标签联机
  var localTab = null;
  var localChannel = null;

  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: 'stun:stun.qq.com:3478' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs',
      credential: 'peerjsp'
    }
  ];

  function supported() {
    return typeof window.Peer === 'function' || typeof window.BroadcastChannel === 'function';
  }

  function tabId() {
    if (!localTab) localTab = 'tab-' + randomToken();
    return localTab;
  }

  function hasLocal() {
    return typeof window.BroadcastChannel === 'function';
  }

  // 可通过 URL 参数或 localStorage 指定自建 PeerServer
  function readPeerConfig() {
    var query = null;
    try { query = new URLSearchParams(window.location.search); } catch (e) { query = null; }
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem('csbp.peer.v1') || 'null'); } catch (e) { saved = null; }

    function pick(name, fallback) {
      var v = query && query.get(name);
      if (v) return v;
      if (saved && saved[name] !== undefined && saved[name] !== '') return saved[name];
      return fallback;
    }

    var host = String(pick('peerhost', '') || '').trim();
    if (!host) return null;
    return {
      host: host,
      port: Number(pick('peerport', 443)) || 443,
      path: String(pick('peerpath', '/')) || '/',
      key: String(pick('peerkey', 'peerjs')) || 'peerjs',
      secure: String(pick('peersecure', '1')) !== '0'
    };
  }

  function isLocalHost() {
    var h = String(window.location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  }

  function relayOptions() {
    return {
      debug: 1,
      host: window.location.hostname,
      port: 9000,
      path: '/peerjs',
      key: 'peerjs',
      secure: false,
      config: { iceServers: ICE_SERVERS }
    };
  }

  function publicOptions() {
    return { debug: 1, config: { iceServers: ICE_SERVERS } };
  }

  // 本机联机信令服务（server/peer-server.js）可用时优先使用，跨浏览器也能联机
  var relayReady = null;
  function probeRelay() {
    if (relayReady !== null) return Promise.resolve(relayReady);
    if (!isLocalHost() || typeof window.fetch !== 'function') {
      relayReady = false;
      return Promise.resolve(false);
    }
    return new Promise(function (resolve) {
      var done = false;
      var timer = window.setTimeout(function () {
        if (done) return;
        done = true;
        relayReady = false;
        resolve(false);
      }, 1200);
      try {
        window.fetch('http://' + window.location.hostname + ':9000/peerjs/peerjs/id', { cache: 'no-store' })
          .then(function (r) {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            relayReady = r.ok;
            resolve(relayReady);
          })
          .catch(function () {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            relayReady = false;
            resolve(false);
          });
      } catch (e) {
        done = true;
        window.clearTimeout(timer);
        relayReady = false;
        resolve(false);
      }
    });
  }

  // 返回按优先级排序的信令服务器配置
  function serverCandidates() {
    var custom = readPeerConfig();
    if (custom) {
      return [{ opts: {
        debug: 1,
        host: custom.host,
        port: custom.port,
        path: custom.path,
        key: custom.key,
        secure: custom.secure,
        config: { iceServers: ICE_SERVERS }
      }, label: 'custom' }];
    }
    var list = [];
    if (relayReady) list.push({ opts: relayOptions(), label: 'relay' });
    list.push({ opts: publicOptions(), label: 'public' });
    return list;
  }

  function normalizeCode(input) {
    return String(input || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LEN);
  }

  function randomFrom(chars, len) {
    var out = '';
    var i;
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint32Array(len);
      window.crypto.getRandomValues(buf);
      for (i = 0; i < len; i += 1) out += chars[buf[i] % chars.length];
    } else {
      for (i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function randomCode() {
    return randomFrom(CODE_CHARS, CODE_LEN);
  }

  function randomToken() {
    return randomFrom(CODE_CHARS, TOKEN_LEN);
  }

  function friendlyError(err) {
    var type = err && err.type ? err.type : '';
    if (type === 'peer-unavailable') return '房间不存在，或房主已经离开';
    if (type === 'unavailable-id') return '房间码冲突，请重新创建';
    if (type === 'browser-incompatible') return '当前浏览器不支持 WebRTC，无法联机';
    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      return '无法连接联机服务器，请检查网络后重试';
    }
    return '连接失败：' + (type || '未知错误');
  }

  function info() {
    var anyOpen = false;
    var sides = { A: false, B: false };

    if (mode === 'host') {
      hostConns.forEach(function (entry) {
        if (entry.opened) {
          anyOpen = true;
          if (entry.side) sides[entry.side] = true;
        }
      });
    } else if (mode === 'guest') {
      anyOpen = guestConnected;
      if (guestConnected && guestSide) sides[guestSide] = true;
    }

    return {
      mode: mode,
      code: code,
      connected: anyOpen,
      sides: sides,
      side: mode === 'guest' ? guestSide : null,
      supported: supported(),
      transport: transport,
      localOnly: transport === 'local'
    };
  }

  function emitStatus() {
    if (handlers.onStatus) handlers.onStatus(info());
  }

  function clearSendTimer() {
    if (sendTimer) {
      window.clearTimeout(sendTimer);
      sendTimer = null;
    }
    pendingSend = false;
  }

  function teardown() {
    session += 1;
    clearSendTimer();

    hostConns.forEach(function (entry) {
      try { entry.conn.close(); } catch (e) { /* ignore */ }
    });
    hostConns = [];

    if (guestConn) {
      try { guestConn.close(); } catch (e) { /* ignore */ }
      guestConn = null;
    }
    if (peer) {
      try { peer.destroy(); } catch (e) { /* ignore */ }
      peer = null;
    }
    if (localChannel) {
      if (mode === 'host') {
        try { localChannel.postMessage({ t: 'host-gone' }); } catch (e) { /* ignore */ }
      }
      try { localChannel.close(); } catch (e) { /* ignore */ }
      localChannel = null;
    }

    guestConnected = false;
    guestSide = null;
    mode = 'local';
    code = null;
    getState = null;
    tokens = { A: null, B: null };
    transport = 'peer';
  }

  function leave() {
    teardown();
    emitStatus();
  }

  function sendStateTo(entry) {
    if (mode !== 'host' || !entry || !entry.opened || !entry.conn.open || !getState) return;
    try {
      entry.conn.send({ t: 'state', state: getState() });
    } catch (e) { /* ignore */ }
  }

  function sendStateNow() {
    if (mode !== 'host' || !getState) return;
    hostConns.forEach(sendStateTo);
  }

  // 房主端：绑定新连接，等待 hello 校验身份
  function bindHostConn(c, mySession) {
    var entry = {
      conn: c,
      side: null,
      opened: false,
      ended: false
    };
    hostConns.push(entry);

    function endConnection(message) {
      if (entry.ended) return;
      entry.ended = true;
      var idx = hostConns.indexOf(entry);
      if (idx >= 0) hostConns.splice(idx, 1);
      emitStatus();
      if (handlers.onDisconnect) handlers.onDisconnect(message, 'host', entry.side);
    }

    function handleOpen() {
      if (entry.opened) return;
      entry.opened = true;
      emitStatus();
      // 先发送当前状态，hello 校验后再按身份补发一次
      sendStateTo(entry);
    }

    c.on('open', function () {
      if (mySession !== session) return;
      handleOpen();
    });

    if (c.open) handleOpen();

    c.on('data', function (data) {
      if (mySession !== session || !data) return;

      if (data.t === 'hello') {
        var side = data.side === 'A' || data.side === 'B' ? data.side : null;
        if (side && data.token && tokens[side] && data.token === tokens[side]) {
          entry.side = side;
        } else {
          entry.side = null;
        }
        try { c.send({ t: 'hello-ack', side: entry.side }); } catch (e) { /* ignore */ }
        emitStatus();
        sendStateTo(entry);
        if (handlers.onJoin) handlers.onJoin(entry.side);
      } else if (data.t === 'action' && handlers.onAction) {
        handlers.onAction(data.action, entry.side);
      }
    });

    c.on('close', function () {
      if (mySession !== session) return;
      var label = entry.side ? entry.side + ' 队长已离开房间' : '观战者已离开房间';
      endConnection(label);
    });

    c.on('error', function () {
      if (mySession !== session) return;
      endConnection('联机连接出现错误');
    });
  }

  // 合并高频变更（如连续输入），最多每 40ms 同步一次完整状态
  function broadcast() {
    if (mode !== 'host' || !getState) return;
    pendingSend = true;
    if (sendTimer) return;
    sendTimer = window.setTimeout(function () {
      sendTimer = null;
      if (!pendingSend) return;
      pendingSend = false;
      sendStateNow();
    }, 40);
  }

  function sendAction(action) {
    if (mode !== 'guest' || !guestConnected || !guestConn || !guestConn.open) return false;
    try {
      guestConn.send({ t: 'action', action: action });
      return true;
    } catch (e) {
      return false;
    }
  }

  function inviteUrl(side) {
    if (mode !== 'host' || !code) return '';
    var base = window.location.href.split('#')[0].split('?')[0];
    var url = base + '?room=' + encodeURIComponent(code);
    if (transport === 'local') url += '&local=1';
    if ((side === 'A' || side === 'B') && tokens[side]) {
      url += '&side=' + side + '&key=' + encodeURIComponent(tokens[side]);
    }
    return url;
  }

  // 本机联机：同一浏览器多标签通过 BroadcastChannel 通信
  function localConn(channel, remoteTab) {
    var listeners = {};
    var conn = {
      open: true,
      remoteTab: remoteTab,
      send: function (data) {
        if (!conn.open) return;
        try {
          channel.postMessage({ t: 'data', from: tabId(), to: remoteTab, payload: data });
        } catch (e) { /* ignore */ }
      },
      close: function () {
        if (!conn.open) return;
        conn.open = false;
        try { channel.postMessage({ t: 'bye', from: tabId(), to: remoteTab }); } catch (e) { /* ignore */ }
        emit('close');
      },
      on: function (event, fn) {
        if (typeof fn !== 'function') return;
        (listeners[event] = listeners[event] || []).push(fn);
      },
      _emit: emit
    };

    function emit(event, arg) {
      (listeners[event] || []).forEach(function (fn) {
        try { fn(arg); } catch (e) { /* ignore */ }
      });
    }

    return conn;
  }

  function findHostTab(tab) {
    for (var i = 0; i < hostConns.length; i += 1) {
      if (hostConns[i].conn && hostConns[i].conn.remoteTab === tab) return hostConns[i];
    }
    return null;
  }

  function startLocalHost() {
    if (!hasLocal()) throw new Error('当前浏览器不支持本机联机');
    var roomCode = randomCode();
    var channel = new window.BroadcastChannel('csbp-local-' + roomCode);
    var mySession = session;
    localChannel = channel;
    transport = 'local';
    code = roomCode;

    channel.onmessage = function (ev) {
      if (mySession !== session) return;
      var msg = ev.data;
      if (!msg || !msg.from) return;

      if (msg.t === 'join') {
        if (findHostTab(msg.from)) return;
        var conn = localConn(channel, msg.from);
        bindHostConn(conn, mySession);
        try { channel.postMessage({ t: 'welcome', from: tabId(), to: msg.from }); } catch (e) { /* ignore */ }
      } else if (msg.t === 'data' && msg.to === tabId()) {
        var entry = findHostTab(msg.from);
        if (entry) entry.conn._emit('data', msg.payload);
      } else if (msg.t === 'bye' && msg.to === tabId()) {
        var closing = findHostTab(msg.from);
        if (closing) {
          closing.conn.open = false;
          closing.conn._emit('close');
        }
      }
    };

    emitStatus();
    return roomCode;
  }

  // 创建 PeerJS 房间；opts 为信令服务器配置，失败由调用方回退到本机联机
  function startPeerHost(mySession, opts) {
    return new Promise(function (resolve, reject) {
      var attempt = 0;
      var roomCode = randomCode();
      var serverOpts = Object.assign({}, opts || publicOptions());

      function tryOnce() {
        var p = new window.Peer(PREFIX + roomCode, serverOpts);
        peer = p;
        var settled = false;

        var timer = window.setTimeout(function () {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          try { p.destroy(); } catch (e) { /* ignore */ }
          if (peer === p) peer = null;
          if (mySession !== session) { reject(new Error('已取消')); return; }
          reject(new Error('创建房间超时，联机服务器不可达'));
        }, 8000);

        p.on('open', function () {
          if (mySession !== session || settled) return;
          settled = true;
          window.clearTimeout(timer);
          code = roomCode;
          transport = 'peer';
          emitStatus();
          resolve({ code: roomCode, local: false });
        });

        p.on('connection', function (incoming) {
          if (mySession !== session) return;
          bindHostConn(incoming, mySession);
        });

        p.on('disconnected', function () {
          if (mySession !== session || peer !== p) return;
          try { p.reconnect(); } catch (e) { /* ignore */ }
        });

        p.on('error', function (err) {
          if (mySession !== session || settled) return;

          if (err && err.type === 'unavailable-id' && attempt < 3) {
            attempt += 1;
            settled = true;
            window.clearTimeout(timer);
            try { p.destroy(); } catch (e) { /* ignore */ }
            if (peer === p) peer = null;
            roomCode = randomCode();
            tryOnce();
            return;
          }

          settled = true;
          window.clearTimeout(timer);
          try { p.destroy(); } catch (e) { /* ignore */ }
          if (peer === p) peer = null;
          reject(new Error(friendlyError(err)));
        });
      }

      tryOnce();
    });
  }

  function createRoom(getStateFn) {
    return new Promise(function (resolve, reject) {
      if (!supported()) {
        reject(new Error('当前浏览器不支持联机'));
        return;
      }

      teardown();
      mode = 'host';
      getState = getStateFn;
      tokens = { A: randomToken(), B: randomToken() };
      var mySession = session;

      function useLocal(lastErr) {
        if (mySession !== session) {
          reject(lastErr || new Error('已取消'));
          return;
        }
        if (peer) {
          try { peer.destroy(); } catch (e) { /* ignore */ }
          peer = null;
        }
        if (!hasLocal()) {
          reject(lastErr || new Error('当前浏览器不支持本机联机'));
          return;
        }
        // 联机服务器不可用时，自动回退到同一浏览器多标签联机
        try {
          resolve({ code: startLocalHost(), local: true });
        } catch (e) {
          reject(lastErr || e);
        }
      }

      if (typeof window.Peer !== 'function') {
        useLocal(new Error('当前浏览器不支持联机'));
        return;
      }

      probeRelay().then(function () {
        if (mySession !== session) {
          reject(new Error('已取消'));
          return;
        }
        var candidates = serverCandidates();
        var idx = 0;

        function next(lastErr) {
          if (mySession !== session) {
            reject(lastErr || new Error('已取消'));
            return;
          }
          if (idx >= candidates.length) {
            useLocal(lastErr);
            return;
          }
          var cand = candidates[idx];
          idx += 1;
          startPeerHost(mySession, cand.opts).then(function (res) {
            if (mySession !== session) {
              reject(new Error('已取消'));
              return;
            }
            res.server = cand.label;
            resolve(res);
          }).catch(function (err) {
            if (mySession !== session) {
              reject(err);
              return;
            }
            if (peer) {
              try { peer.destroy(); } catch (e) { /* ignore */ }
              peer = null;
            }
            next(err);
          });
        }

        next(null);
      });
    });
  }

  // 统一处理访客连接（PeerJS 与本机联机共用）
  function openGuestConn(c, mySession, side, token) {
    return new Promise(function (resolve, reject) {
      var done = false;
      guestConn = c;

      function finish(err) {
        if (done) return;
        done = true;
        if (err) reject(err);
        else resolve();
      }

      c.on('open', function () {
        if (mySession !== session) return finish(new Error('已取消'));
        guestConnected = true;
        emitStatus();
        try { c.send({ t: 'hello', side: side, token: token }); } catch (e) { /* ignore */ }
        finish();
      });

      c.on('data', function (data) {
        if (mySession !== session || !data) return;
        if (data.t === 'state' && handlers.onState) {
          handlers.onState(data.state);
        } else if (data.t === 'hello-ack') {
          guestSide = data.side === 'A' || data.side === 'B' ? data.side : null;
          emitStatus();
        } else if (data.t === 'action' && handlers.onAction) {
          handlers.onAction(data.action, guestSide);
        }
      });

      c.on('close', function () {
        if (mySession !== session) return;
        if (!done) {
          finish(new Error('房主拒绝了连接'));
          return;
        }
        guestConnected = false;
        guestConn = null;
        emitStatus();
        if (handlers.onDisconnect) handlers.onDisconnect('与房主的连接已断开', 'guest', guestSide);
      });

      c.on('error', function () {
        if (mySession !== session) return;
        if (!done) {
          finish(new Error('无法连接到房主'));
          return;
        }
        guestConnected = false;
        guestConn = null;
        emitStatus();
        if (handlers.onDisconnect) handlers.onDisconnect('联机连接出现错误', 'guest', guestSide);
      });

      // 本机联机的连接创建即已打开
      if (c.open) {
        window.setTimeout(function () { c._emit('open'); }, 0);
      }
    });
  }

  function startPeerGuest(mySession, roomCode, side, token, opts) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var p = new window.Peer(Object.assign({}, opts || publicOptions()));
      peer = p;

      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try { p.destroy(); } catch (e) { /* ignore */ }
        if (peer === p) peer = null;
        reject(new Error('连接房主超时'));
      }, 8000);

      p.on('open', function () {
        if (mySession !== session || settled) return;
        var c;
        try {
          c = p.connect(PREFIX + roomCode, { reliable: true, serialization: 'json' });
        } catch (e) {
          settled = true;
          window.clearTimeout(timer);
          try { p.destroy(); } catch (err) { /* ignore */ }
          reject(new Error('无法建立连接'));
          return;
        }

        openGuestConn(c, mySession, side, token).then(function () {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve();
        }).catch(function (err) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          try { p.destroy(); } catch (e2) { /* ignore */ }
          reject(err);
        });
      });

      p.on('error', function (err) {
        if (mySession !== session || settled) return;
        settled = true;
        window.clearTimeout(timer);
        try { p.destroy(); } catch (e) { /* ignore */ }
        if (peer === p) peer = null;
        reject(new Error(friendlyError(err)));
      });
    });
  }

  function startLocalGuest(mySession, roomCode, side, token) {
    return new Promise(function (resolve, reject) {
      var channel;
      try {
        channel = new window.BroadcastChannel('csbp-local-' + roomCode);
      } catch (e) {
        reject(new Error('当前浏览器不支持本机联机'));
        return;
      }

      localChannel = channel;
      transport = 'local';
      var joined = false;

      var timer = window.setTimeout(function () {
        if (joined) return;
        joined = true;
        try { channel.close(); } catch (e) { /* ignore */ }
        if (localChannel === channel) localChannel = null;
        reject(new Error('房间不存在，或房主已经离开'));
      }, 2500);

      channel.onmessage = function (ev) {
        var msg = ev.data;
        if (!msg || !msg.to || msg.to !== tabId()) return;

        if (msg.t === 'welcome') {
          if (joined) return;
          joined = true;
          window.clearTimeout(timer);
          var c = localConn(channel, msg.from);
          openGuestConn(c, mySession, side, token).then(resolve).catch(reject);
        } else if (msg.t === 'data') {
          if (guestConn) guestConn._emit('data', msg.payload);
        } else if (msg.t === 'bye') {
          if (guestConn) {
            guestConn.open = false;
            guestConn._emit('close');
          }
        } else if (msg.t === 'host-gone') {
          if (!guestConnected) return;
          guestConnected = false;
          guestConn = null;
          emitStatus();
          if (handlers.onDisconnect) handlers.onDisconnect('与房主的连接已断开', 'guest', guestSide);
        }
      };

      channel.postMessage({ t: 'join', from: tabId() });
    });
  }

  function joinRoom(inputCode, opts) {
    return new Promise(function (resolve, reject) {
      var roomCode = normalizeCode(inputCode);
      if (!supported()) {
        reject(new Error('当前浏览器不支持联机'));
        return;
      }
      if (roomCode.length !== CODE_LEN) {
        reject(new Error('房间码为 ' + CODE_LEN + ' 位字母或数字'));
        return;
      }

      var side = opts && (opts.side === 'A' || opts.side === 'B') ? opts.side : null;
      var token = opts && typeof opts.token === 'string' ? opts.token : '';

      teardown();
      mode = 'guest';
      code = roomCode;
      guestSide = side;
      var mySession = session;

      var preferLocal = false;
      try { preferLocal = new URLSearchParams(window.location.search).get('local') === '1'; } catch (e) { /* ignore */ }
      var usePeer = !preferLocal && typeof window.Peer === 'function';

      function fallbackLocal(peerErr) {
        if (mySession !== session) {
          reject(peerErr || new Error('已取消'));
          return;
        }
        if (peer) {
          try { peer.destroy(); } catch (e) { /* ignore */ }
          peer = null;
        }
        if (guestConn) {
          try { guestConn.close(); } catch (e) { /* ignore */ }
          guestConn = null;
        }
        guestConnected = false;
        if (!hasLocal()) {
          reject(peerErr || new Error('无法连接联机服务器，请检查网络后重试'));
          return;
        }
        // 联机服务器不可用时尝试同一浏览器多标签联机
        teardown();
        mode = 'guest';
        code = roomCode;
        guestSide = side;
        var localSession = session;
        startLocalGuest(localSession, roomCode, side, token).then(function () {
          if (localSession !== session) {
            reject(new Error('已取消'));
            return;
          }
          resolve();
        }).catch(function () {
          if (localSession !== session) {
            reject(new Error('已取消'));
            return;
          }
          teardown();
          reject(new Error('无法加入房间：请确认房主在线；同一台电脑联机请先在项目目录运行 node server/peer-server.js 启动本地信令服务'));
        });
      }

      if (!usePeer) {
        fallbackLocal(new Error('使用本机联机'));
        return;
      }

      probeRelay().then(function () {
        if (mySession !== session) {
          reject(new Error('已取消'));
          return;
        }
        var candidates = serverCandidates();
        var idx = 0;
        var lastErr = null;

        function next() {
          if (mySession !== session) {
            reject(lastErr || new Error('已取消'));
            return;
          }
          if (idx >= candidates.length) {
            fallbackLocal(lastErr);
            return;
          }
          var cand = candidates[idx];
          idx += 1;
          startPeerGuest(mySession, roomCode, side, token, cand.opts).then(function () {
            if (mySession !== session) {
              reject(new Error('已取消'));
              return;
            }
            resolve();
          }).catch(function (err) {
            if (mySession !== session) {
              reject(err);
              return;
            }
            lastErr = err;
            if (peer) {
              try { peer.destroy(); } catch (e) { /* ignore */ }
              peer = null;
            }
            if (guestConn) {
              try { guestConn.close(); } catch (e) { /* ignore */ }
              guestConn = null;
            }
            guestConnected = false;
            next();
          });
        }

        next();
      });
    });
  }

  function init(opts) {
    handlers = opts || {};
  }

  window.addEventListener('beforeunload', function () {
    teardown();
  });

  CSBP.Net = {
    init: init,
    info: info,
    createRoom: createRoom,
    joinRoom: joinRoom,
    sendAction: sendAction,
    broadcast: broadcast,
    inviteUrl: inviteUrl,
    leave: leave,
    normalizeCode: normalizeCode,
    supported: supported
  };
})();
