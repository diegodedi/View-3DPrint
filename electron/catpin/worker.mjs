import { parentPort, workerData } from 'node:worker_threads';
import { runJob } from './engine.mjs';

try {
  const result = await runJob(workerData);
  const transfer = [];
  if (result?.partA?.stl) transfer.push(result.partA.stl);
  if (result?.partB?.stl) transfer.push(result.partB.stl);
  parentPort.postMessage({ ok: true, result }, transfer);
} catch (e) {
  parentPort.postMessage({ ok: false, code: e?.code ?? 'INTERNAL', message: e?.message ?? String(e) });
}

