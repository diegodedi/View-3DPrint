'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');

/**
 * Executa um job do motor CatPin numa worker thread DESCARTÁVEL (uma por operação):
 * não trava o app e a memória do WASM é liberada quando a thread termina.
 * Retorna sempre { success:true, ...resultado } ou { success:false, code, error }.
 */
function runCatpinJob(payload, timeoutMs = 240000) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const worker = new Worker(path.join(__dirname, 'worker.mjs'), {
      workerData: payload,
      resourceLimits: {
        maxOldGenerationSizeMb: 4096,
        maxYoungGenerationSizeMb: 1024,
      },
    });
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(value);
    };
    timer = setTimeout(
      () => finish({ success: false, code: 'TIMEOUT', error: 'Operação excedeu o tempo limite. Tente um modelo mais leve.' }),
      timeoutMs
    );
    worker.once('message', (m) =>
      finish(m.ok ? { success: true, ...m.result } : { success: false, code: m.code, error: m.message })
    );
    worker.once('error', (e) => finish({ success: false, code: 'INTERNAL', error: `Erro no motor de corte: ${e.message}` }));
    worker.once('exit', (code) => {
      if (code !== 0) finish({ success: false, code: 'INTERNAL', error: `Motor encerrou com código ${code}` });
    });
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
