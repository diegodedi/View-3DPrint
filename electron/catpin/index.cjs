'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');

const WORKER_PATH = path.join(__dirname, 'worker.mjs');
const IDLE_TERMINATE_MS = 25000;

let warmWorker = null;
let idleTimer = null;
let isBusy = false;
let jobSeq = 0;
const pendingQueue = [];

function destroyWarmWorker() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (warmWorker) {
    const w = warmWorker;
    warmWorker = null;
    w.removeAllListeners();
    w.terminate().catch(() => {});
  }
}

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  if (warmWorker && typeof warmWorker.unref === 'function') {
    warmWorker.unref();
  }
  idleTimer = setTimeout(() => {
    if (!isBusy && pendingQueue.length === 0) {
      destroyWarmWorker();
    }
  }, IDLE_TERMINATE_MS);
  if (typeof idleTimer.unref === 'function') {
    idleTimer.unref();
  }
}

function ensureWarmWorker() {
  if (warmWorker) return warmWorker;
  warmWorker = new Worker(WORKER_PATH, {
    resourceLimits: {
      maxOldGenerationSizeMb: 4096,
      maxYoungGenerationSizeMb: 1024,
    },
  });
  return warmWorker;
}

function pumpQueue() {
  if (isBusy || pendingQueue.length === 0) {
    if (!isBusy && pendingQueue.length === 0 && warmWorker) {
      scheduleIdleShutdown();
    }
    return;
  }

  const job = pendingQueue.shift();
  isBusy = true;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  const worker = ensureWarmWorker();
  if (typeof worker.ref === 'function') {
    worker.ref();
  }

  const id = ++jobSeq;
  let done = false;
  let timer = null;

  const cleanupListeners = () => {
    worker.off('message', onMessage);
    worker.off('error', onError);
    worker.off('exit', onExit);
  };

  const finish = (value, fatal) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cleanupListeners();
    if (fatal) {
      destroyWarmWorker();
    }
    isBusy = false;
    job.resolve(value);
    pumpQueue();
  };

  const onMessage = (m) => {
    if (!m || m.id !== id) return;
    finish(
      m.ok ? { success: true, ...m.result } : { success: false, code: m.code, error: m.message },
      false
    );
  };

  const onError = (e) => {
    finish({ success: false, code: 'INTERNAL', error: `Erro no motor de corte: ${e.message}` }, true);
  };

  const onExit = (code) => {
    finish({ success: false, code: 'INTERNAL', error: `Motor encerrou com código ${code}` }, true);
  };

  worker.on('message', onMessage);
  worker.on('error', onError);
  worker.on('exit', onExit);

  timer = setTimeout(() => {
    finish(
      { success: false, code: 'TIMEOUT', error: 'Operação excedeu o tempo limite. Tente um modelo mais leve.' },
      true
    );
  }, job.timeoutMs);

  worker.postMessage({ id, payload: job.payload });
}

/**
 * Executa um job do motor CatPin em worker thread persistente (reaproveita WASM compilado
 * entre operações consecutivas e encerra automaticamente após ociosidade).
 * Retorna sempre { success:true, ...resultado } ou { success:false, code, error }.
 */
function runCatpinJob(payload, timeoutMs = 240000) {
  return new Promise((resolve) => {
    pendingQueue.push({ payload, timeoutMs, resolve });
    pumpQueue();
  });
}

/** Adaptador: devolve o formato que a UI (CatpinCutResult) já espera. */
async function executeCatpinCutForUi(payload) {
  const r = await runCatpinJob({ type: 'cut', ...payload });
  if (!r.success) return r;
  return {
    success: true,
    partABuffer: r.partA.stl,
    partBBuffer: r.partB.stl,
    partATriangles: r.partA.triangles,
    partBTriangles: r.partB.triangles,
    islandsA: r.partA.islands,
    islandsB: r.partB.islands,
    executionTimeMs: r.timeMs,
    explodeDirStl: r.explodeDir,
    seamCenterStl: r.seamCenter,
    warnings: r.warnings,
    minGapMm: r.minGapMm,
    connectorUsed: r.connectorUsed,
  };
}

/** Sugere posição/eixo do pino numa face plana do corte. */
function suggestCatpinPinForUi(payload) {
  return runCatpinJob({ type: 'suggest', ...payload }, 60000);
}

/** Executa o diagnóstico geométrico completo da malha antes do corte. */
function diagnoseCatpinModelForUi(payload) {
  return runCatpinJob({ type: 'diagnose', ...payload }, 60000);
}

module.exports = {
  runCatpinJob,
  executeCatpinCutForUi,
  suggestCatpinPinForUi,
  diagnoseCatpinModelForUi,
};
