import { parentPort, workerData } from 'node:worker_threads';
import { runJob } from './engine.mjs';

async function handleJob(job) {
  const result = await runJob(job);
  const transfer = [];
  if (result?.partA?.stl instanceof ArrayBuffer) transfer.push(result.partA.stl);
  if (result?.partB?.stl instanceof ArrayBuffer) transfer.push(result.partB.stl);
  return { result, transfer };
}

if (workerData) {
  try {
    const { result, transfer } = await handleJob(workerData);
    parentPort.postMessage({ ok: true, result }, transfer);
  } catch (e) {
    parentPort.postMessage({ ok: false, code: e?.code ?? 'INTERNAL', message: e?.message ?? String(e) });
  }
} else if (parentPort) {
  parentPort.on('message', async ({ id, payload }) => {
    try {
      const { result, transfer } = await handleJob(payload);
      parentPort.postMessage({ id, ok: true, result }, transfer);
    } catch (e) {
      parentPort.postMessage({ id, ok: false, code: e?.code ?? 'INTERNAL', message: e?.message ?? String(e) });
    }
  });
}
