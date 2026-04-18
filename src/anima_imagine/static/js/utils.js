/**
 * AnimaImagine v2 通用工具函数。
 *
 * v2 变更：
 * - 移除了 calcResolution（分辨率现在从服务端获取，解决前后端分叉问题）
 * - 新增 UI 配置加载函数
 */

// ============================================================
// HTML 转义
// ============================================================

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
// v2: UI 配置（从服务端加载，单一真相源）
// ============================================================

/** 服务端分辨率预设表，启动时从 /api/config/ui 加载 */
let _uiConfig = null;

/**
 * v2: 从服务端加载 UI 配置（分辨率预设、默认参数）。
 * 解决前后端分辨率不一致的问题 — 现在只有后端一个真相源。
 */
export async function loadUIConfig() {
  try {
    const resp = await fetch('/api/config/ui');
    if (resp.ok) {
      _uiConfig = await resp.json();
      console.log('[UI Config] Loaded', _uiConfig.presets?.length, 'presets');
    }
  } catch (e) {
    console.warn('[UI Config] Failed to load:', e);
  }
  return _uiConfig;
}

/** v2: 获取已加载的 UI 配置 */
export function getUIConfig() {
  return _uiConfig;
}

/**
 * v2: 从服务端预设表查找分辨率。
 * 替代旧的 calcResolution，不再在前端计算。
 *
 * @param {string} ratio - 如 "3:4"
 * @param {number} megapixels - 目标 MP
 * @returns {{width: number, height: number, actualMP: number}}
 */
export function getResolution(ratio, megapixels = 1.0) {
  if (!_uiConfig || !_uiConfig.presets) {
    // 未加载时的 fallback
    return { width: 1024, height: 1024, actualMP: 1.05 };
  }
  // 从预设表查找基准分辨率
  const preset = _uiConfig.presets.find(p => p.ratio === ratio);
  if (!preset) {
    return { width: 1024, height: 1024, actualMP: 1.05 };
  }

  // MP 缩放：基准预设是 1.0 MP，按 sqrt(mp) 等比缩放
  let w = preset.width;
  let h = preset.height;
  if (Math.abs(megapixels - 1.0) > 0.01) {
    const scale = Math.sqrt(megapixels);
    w = _align16(Math.round(w * scale));
    h = _align16(Math.round(h * scale));
  }
  const actualMP = Math.round((w * h) / 10000) / 100;
  return { width: w, height: h, actualMP };
}

function _align16(v) {
  return Math.max(16, Math.round(v / 16) * 16);
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
// 标签分类
// ============================================================

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
