const DEFAULT_LOGGER = (message) => {
  if (typeof console !== 'undefined' && console.debug) {
    console.debug(`[LiteVM bridge] ${message}`);
  }
};

function ensureLogger(options) {
  if (options && typeof options.logger === 'function') {
    return options.logger;
  }
  return DEFAULT_LOGGER;
}

function createStubWebGLContext(logger) {
  return {
    clear: () => logger('WebGL.clear()'),
    drawArrays: () => logger('WebGL.drawArrays()'),
    getParameter: () => 0,
    getExtension: () => null,
  };
}

function createStubAudioContext(logger) {
  return {
    playSample: (name) => logger(`WebAudio.playSample(${name})`),
    stopAll: () => logger('WebAudio.stopAll()'),
  };
}

function createStubSocket(logger, url) {
  return {
    url,
    send: (payload) => logger(`WebSocket.send(${payload})`),
    close: () => logger('WebSocket.close()'),
  };
}

function createStubFileBridge(logger) {
  return {
    readText: () => {
      logger('File.readText() -> ""');
      return '';
    },
    writeText: () => logger('File.writeText()'),
  };
}

export function installDefaultBridges(runtime, options = {}) {
  const logger = ensureLogger(options);

  const webglFactory = options.createWebGLContext ?? (() => createStubWebGLContext(logger));
  runtime.registerBridge(
    'litevm/bridge/WebGL',
    'createContext:(Ljava/lang/String;)Ljava/lang/Object;',
    ([canvasId]) => webglFactory(canvasId),
  );

  const audioFactory = options.createAudioContext ?? (() => createStubAudioContext(logger));
  runtime.registerBridge(
    'litevm/bridge/WebAudio',
    'createContext:()Ljava/lang/Object;',
    () => audioFactory(),
  );

  const socketFactory = options.createWebSocket ?? ((url) => createStubSocket(logger, url));
  runtime.registerBridge(
    'litevm/bridge/WebSocket',
    'connect:(Ljava/lang/String;)Ljava/lang/Object;',
    ([url]) => socketFactory(url),
  );

  const fileBridge = options.createFileBridge ?? (() => createStubFileBridge(logger));
  const fileHost = fileBridge();
  runtime.registerBridge(
    'litevm/bridge/File',
    'readText:(Ljava/lang/String;)Ljava/lang/String;',
    ([path]) => {
      if (typeof fileHost.readText === 'function') {
        return fileHost.readText(path);
      }
      logger(`File.readText(${path}) -> ""`);
      return '';
    },
  );
  runtime.registerBridge(
    'litevm/bridge/File',
    'writeText:(Ljava/lang/String;Ljava/lang/String;)V',
    ([path, contents]) => {
      if (typeof fileHost.writeText === 'function') {
        fileHost.writeText(path, contents);
      } else {
        logger(`File.writeText(${path})`);
      }
    },
  );
}

export function createDefaultBridgeHost(logger = DEFAULT_LOGGER) {
  return {
    webgl: createStubWebGLContext(logger),
    audio: createStubAudioContext(logger),
    socket: (url) => createStubSocket(logger, url),
    file: createStubFileBridge(logger),
  };
}
