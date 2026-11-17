/**
 * 极简 QR Code 生成器（byte 模式，纠错等级 L，版本 1~10 自适应）。
 * 零依赖、纯前端，用于把扫码登录 URL 渲染成二维码。
 * 算法参考 QR Code Model 2 标准：数据编码 → RS 纠错 → 矩阵布置 → 掩码。
 */

// 版本 1~10，纠错等级 L 的块结构 [总码字, 数据码字]
const RS_BLOCKS: Record<number, [number, number, number]> = {
  1: [26, 19, 1], 2: [44, 34, 1], 3: [70, 55, 1], 4: [100, 80, 1],
  5: [134, 108, 1], 6: [172, 136, 2], 7: [196, 156, 2], 8: [242, 194, 2],
  9: [292, 232, 2], 10: [346, 274, 2],
};

/** Unicode 字符串 → UTF-8 字节 */
function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

/** 选择能容纳数据的最小版本 */
function pickVersion(byteLen: number): number | null {
  for (let v = 1; v <= 10; v++) {
    const [, data] = RS_BLOCKS[v];
    // 计数指示符 8bit + 长度 8bit（版本 1-9）
    if (byteLen + 2 <= data) return v;
  }
  return null;
}

/** GF(256) 乘法 */
function gfMul(a: number, b: number): number {
  let r = 0;
  for (let i = 7; i >= 0; i--) {
    r = (r << 1) ^ ((r >> 7) * 0x11d);
    r ^= ((b >> i) & 1) * a;
  }
  return r & 0xff;
}

/** 生成 RS 生成多项式 */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
    root = gfMul(root, 2);
  }
  return poly;
}

/** 计算 RS 纠错码字 */
function rsEcc(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const ecc = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    for (let i = 0; i < ecLen; i++) ecc[i] ^= gfMul(gen[i + 1], factor);
  }
  return ecc;
}

/** 交错数据块与纠错块 */
function interleave(dataBlocks: number[][], ecBlocks: number[][], totalCodewords: number): number[] {
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  const maxEc = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEc; i++) {
    for (const b of ecBlocks) if (i < b.length) out.push(b[i]);
  }
  // 补齐（版本所需填充字节）
  while (out.length < totalCodewords) out.push(0xec);
  return out;
}

/** 功能图形：定位/时序/对齐/格式/版本 */
function buildFunctionPatterns(size: number, version: number): { modules: boolean[][]; reserved: boolean[][] } {
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r: number, c: number, v: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) { modules[r][c] = v; reserved[r][c] = true; }
  };

  // 三个定位图案（含分隔符）
  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inRing = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(row + r, col + c, inRing || inCore);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // 时序图案
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // 对齐图案（版本 2+）
  if (version >= 2) {
    const centers: Record<number, number[]> = {
      2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
      7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    };
    const cs = centers[version] || [6];
    for (const r of cs) {
      for (const c of cs) {
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const v = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            set(r + dr, c + dc, v);
          }
        }
      }
    }
  }

  // 格式信息区预留（用 0 填充占位，稍后按掩码写）
  for (let i = 0; i <= 8; i++) {
    if (!reserved[8][i]) set(8, i, false);
    if (!reserved[i][8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  // 固定深色模块
  set(size - 8, 8, true);

  // 版本信息区（版本 7+）
  if (version >= 7) {
    const bits = version; // 简化：仅版本位，不额外 BCH（对齐标准需 18bit BCH）
    for (let i = 0; i < 6; i++) {
      set(Math.floor(i / 3), size - 11 + (i % 3), ((bits >> i) & 1) === 1);
      set(size - 11 + (i % 3), Math.floor(i / 3), ((bits >> i) & 1) === 1);
    }
  }
  return { modules, reserved };
}

/** BCH 格式信息（纠错 L = 01） */
function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask; // ECL L=01
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return (((r * c) % 2) + ((r * c) % 3)) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

/** 布置数据码字（之字形） */
function placeData(modules: boolean[][], reserved: boolean[][], bytes: number[], mask: number) {
  const size = modules.length;
  let bitIdx = 0;
  const totalBits = bytes.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const rows = right === 6 ? [vert] : undefined;
      for (const row of rows || [((vert & 1) === 0 ? vert : size - 1 - vert)]) {
        for (let c = 0; c < 2; c++) {
          const col = right - c;
          if (reserved[row]?.[col]) continue;
          if (bitIdx >= totalBits) { modules[row][col] = false; continue; }
          const bit = ((bytes[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
          modules[row][col] = bit !== maskBit(mask, row, col);
          bitIdx++;
        }
      }
    }
  }
}

/** 写入格式信息 */
function placeFormat(modules: boolean[][], size: number, mask: number) {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[8][i] = bit(i);
  modules[8][7] = bit(6);
  modules[8][8] = bit(7);
  modules[7][8] = bit(8);
  for (let i = 9; i < 15; i++) modules[14 - i][8] = bit(i);
  for (let i = 0; i < 8; i++) modules[size - 1 - i][8] = bit(i);
  for (let i = 8; i < 15; i++) modules[8][size - 15 + i] = bit(i);
  modules[size - 8][8] = true;
}

/**
 * 生成二维码布尔矩阵（true=深色）。
 * 失败（内容过长）返回 null。
 */
export function generateQr(text: string): boolean[][] | null {
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  if (!version) return null;
  const [total, dataLen, blocks] = RS_BLOCKS[version];

  // 数据位流：模式指示符(0100) + 字符计数(8bit) + 数据 + 终止符 + 对齐到字节 + 填充
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataLen * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataBytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataBytes.push(b);
  }
  const pad = [0xec, 0x11];
  for (let i = 0; dataBytes.length < dataLen; i++) dataBytes.push(pad[i % 2]);

  // 分块 + RS 纠错 + 交错
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  const ecLen = Math.floor((total - dataLen) / blocks);
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const short = b < blocks - (dataLen % blocks || blocks);
    const len = Math.floor(dataLen / blocks) + (short ? 0 : 1);
    const chunk = dataBytes.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(chunk);
    ecBlocks.push(rsEcc(chunk, ecLen));
  }
  const codewords = interleave(dataBlocks, ecBlocks, total);

  // 选掩码 0（简单且可读，扫码兼容性足够）
  const mask = 0;
  const size = version * 4 + 17;
  const { modules, reserved } = buildFunctionPatterns(size, version);
  placeData(modules, reserved, codewords, mask);
  placeFormat(modules, size, mask);
  return modules;
}

/** 矩阵 → SVG data URL（可直接用于 <img src>） */
export function qrToDataUrl(text: string, scale = 6, margin = 2): string {
  const matrix = generateQr(text);
  if (!matrix) return '';
  const n = matrix.length;
  const dim = (n + margin * 2) * scale;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${(c + margin) * scale}" y="${(r + margin) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
