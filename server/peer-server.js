'use strict';

var PeerServer = require('peer').PeerServer;
var port = Number(process.env.PORT || 9000);

PeerServer({
  port: port,
  path: '/peerjs',
  key: 'peerjs',
  allow_discovery: false,
  proxied: false
});

console.log('[csbp] PeerServer signaling ready at ws://127.0.0.1:' + port + '/peerjs');
