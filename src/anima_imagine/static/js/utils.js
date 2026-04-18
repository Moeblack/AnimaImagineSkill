/**
 * AnimaImagine 通用工具函数。
 * Phase 1.1: 从 gallery.html 抽出的公共逻辑 + 新增 Toast / 分辨率计算等工具。
 */

// ============================================================
// HTML 转义
// ============================================================

/** 转义 HTML 特殊字符，防止 XSS */
export function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ============================================================
// 数字格式化
// ============================================================

/** 将数字转为人类可读格式：1234 → 1.2k，1234567 → 1.2M */
export function formatCount(num) {
  if (num == null || isNaN(num)) return '0';
  if (num < 1000) return String(num);
  const units = [
    { value: 1e9, symbol: 'G' },
    { value: 1e6, symbol: 'M' },
    { value: 1e3, symbol: 'k' },
  ];
  for (const u of units) {
    if (num >= u.value) {
      return (num / u.value).toFixed(1).replace(/\.0$/, '') + u.symbol;
    }
  }
  return String(num);
}

// ============================================================
// 分辨率计算（Aspect Ratio × Megapixels）
// ============================================================

/**
 * 根据宽高比和目标总像素数计算分辨率。
 * 结果对齐到 16 的倍数（Cosmos VAE 架构要求）。
 *
 * @param {string} ratio - 宽高比，如 "3:4"
 * @param {number} megapixels - 目标总像素数（百万），如 1.0, 1.5, 2.0
 * @returns {{width: number, height: number, actualMP: number}}
 */
export function calcResolution(ratio, megapixels) {
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh || !megapixels) return { width: 1024, height: 1024, actualMP: 1.05 };
  const totalPixels = megapixels * 1_000_000;
  // width = sqrt(totalPixels * rw / rh)
  let width = Math.sqrt(totalPixels * rw / rh);
  let height = width * rh / rw;
  // 对齐到 16 的倍数
  width = Math.round(width / 16) * 16;
  height = Math.round(height / 16) * 16;
  const actualMP = (width * height) / 1_000_000;
  return { width, height, actualMP: Math.round(actualMP * 100) / 100 };
}

// ============================================================
// Toast 通知系统
// ============================================================

let _toastContainer = null;

function ensureToastContainer() {
  if (_toastContainer) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.className = 'toast-container';
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

/**
 * 显示 Toast 通知。
 * @param {string} message - 消息文本
 * @param {'success'|'error'|'info'} type - 类型
 * @param {number} duration - 显示时长（ms）
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ============================================================
// 标签分类规则（从 gallery.html 迁移）
// ============================================================

/** 根据标签内容返回 CSS 类名，用于卡片中的标签颜色 */
export function tagClass(tag) {
  const t = tag.toLowerCase();
  if (t.startsWith('@'))                             return 'artist';
  if (/^(safe|sensitive)$/.test(t))                   return 'safety';
  if (/^(nsfw|explicit)$/.test(t))                    return 'nsfw';
  if (/^(masterpiece|best quality|highres)/.test(t))  return 'quality';
  if (/^score_/.test(t))                              return 'score';
  if (/^\d*(girl|boy|other)s?$/.test(t) || t === 'no humans') return 'count';
  return '';
}
