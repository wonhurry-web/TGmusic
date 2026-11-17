import { parentPort } from 'node:worker_threads';
import { sign, md5 } from './sign.js';

/**
 * 签名工作线程：在独立线程执行 CPU 密集的 MD5 签名，
 * 使主线程能专注处理网络 I/O 与 WebSocket 广播。
 */
parentPort.on('message', (task) => {
  const { id, op, params, secret, body, text } = task;
  try {
    let result;
    if (op === 'sign') result = sign(params, secret, body || '');
    else if (op === 'md5') result = md5(text);
    else throw new Error(`unknown op: ${op}`);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
