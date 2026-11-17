import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign, md5 } from './sign.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_FILE = path.join(__dirname, 'sign.worker.js');

/**
 * 签名线程池（多线程优化）。
 * - 维护 N 个 worker 并行处理 MD5 签名任务，避免阻塞主线程事件循环。
 * - 批量签名走 worker；worker 不可用/超时自动降级到主线程同步计算，保证可用。
 */
export class SignPool {
  constructor(size = 4, timeoutMs = 3000) {
    this.size = Math.max(1, size);
    this.timeoutMs = timeoutMs;
    this.workers = [];
    this.roundRobin = 0;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.seq = 0;
    this._started = false;
  }

  start() {
    if (this._started) return;
    this._started = true;
    for (let i = 0; i < this.size; i++) this._spawn(i);
  }

  _spawn(index) {
    let worker;
    try {
      worker = new Worker(WORKER_FILE);
    } catch {
      return; // worker 创建失败：降级到主线程
    }
    worker.on('message', (msg) => {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error));
    });
    worker.on('error', () => this._reset(index, worker));
    worker.on('exit', () => this._reset(index, worker));
    this.workers[index] = worker;
  }

  _reset(index, worker) {
    if (this.workers[index] !== worker) return;
    // 拒绝所有分发给该 worker 的未完成任务，让上层降级
    for (const [id, entry] of this.pending) {
      if (entry.workerIndex === index) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(new Error('worker exited'));
      }
    }
    this._spawn(index);
  }

  _dispatch(op, payload) {
    const alive = this.workers.filter(Boolean);
    if (alive.length === 0) return Promise.reject(new Error('no worker'));
    const index = this.roundRobin++ % alive.length;
    const worker = alive[index];
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('sign worker timeout'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, workerIndex: this.workers.indexOf(worker) });
      worker.postMessage({ id, op, ...payload });
    });
  }

  /** 计算 gateway 签名，失败自动降级主线程 */
  async sign(params, secret, body = '') {
    try {
      return await this._dispatch('sign', { params, secret, body });
    } catch {
      return sign(params, secret, body);
    }
  }

  /** 计算 md5，失败自动降级主线程 */
  async md5(text) {
    try {
      return await this._dispatch('md5', { text });
    } catch {
      return md5(text);
    }
  }

  /** 批量签名：真正并行分发到多个 worker */
  async signBatch(items, secret) {
    return Promise.all(
      items.map((item) => this.sign(item.params, secret, item.body || ''))
    );
  }

  close() {
    for (const w of this.workers) {
      if (w) w.terminate().catch(() => {});
    }
    this.workers = [];
    for (const [, entry] of this.pending) clearTimeout(entry.timer);
    this.pending.clear();
    this._started = false;
  }
}

export default SignPool;
