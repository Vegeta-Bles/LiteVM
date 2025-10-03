import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiteVMRuntime } from '../runtime/runtime.js';
import { installDefaultBridges } from '../runtime/bridges/default.js';

test('default bridges register and stub', () => {
  const runtime = LiteVMRuntime.bootstrap([]);
  const calls = [];
  installDefaultBridges(runtime, {
    logger: (msg) => calls.push(msg),
  });

  const webglBridge = runtime.bridges.get('litevm/bridge/WebGL#createContext:(Ljava/lang/String;)Ljava/lang/Object;');
  assert.ok(webglBridge, 'webgl bridge registered');
  const gl = webglBridge(['canvas']);
  assert.ok(gl);
  gl.clear?.();

  const socketBridge = runtime.bridges.get('litevm/bridge/WebSocket#connect:(Ljava/lang/String;)Ljava/lang/Object;');
  assert.ok(socketBridge, 'websocket bridge registered');
  const socket = socketBridge(['wss://example']);
  socket.send?.('ping');
  socket.close?.();

  const fileRead = runtime.bridges.get('litevm/bridge/File#readText:(Ljava/lang/String;)Ljava/lang/String;');
  assert.equal(fileRead(['path/config.json']), '');

  assert.ok(calls.length >= 1, 'logger receives bridge calls');
});
