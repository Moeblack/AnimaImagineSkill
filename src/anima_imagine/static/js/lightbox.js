/**
 * AnimaImagine Lightbox 模块。
 * Phase 3.2: 完整重构——工具栏、元数据面板、缩略图导航、翻页、缩放。
 */

import { escapeHtml, showToast } from './utils.js';

// ============================================================
// 状态
// ============================================================

let currentImages = [];  // 当前可浏览的图片列表
let currentIndex = -1;
let metaExpanded = true;

// 外部回调
let onFillGenerator = null;

// DOM
let lbRoot, lbImg, lbPrompt, lbParams, lbThumbstrip;

// ============================================================
// 初始化
// ============================================================

export function init(options = {}) {
  onFillGenerator = options.onFillGenerator || null;

  lbRoot = document.getElementById('lightbox');
  lbImg = document.getElementById('lightboxImg');
  lbPrompt = document.getElementById('lbPrompt');
  lbParams = document.getElementById('lbParams');
  lbThumbstrip = document.getElementById('lbThumbstrip');

  // 关闭
  document.getElementById('lbClose')?.addEventListener('click', close);
  lbRoot.addEventListener('click', (e) => {
    // 只有点击背景层才关闭，点击工具栏/图片不关闭
    if (e.target === lbRoot) close();
  });

  // 导航
  document.getElementById('lbPrev')?.addEventListener('click', () => navigate(-1));
  document.getElementById('lbNext')?.addEventListener('click', () => navigate(1));

  // 工具栏按钮
  document.getElementById('lbDownload')?.addEventListener('click', _download);
  document.getElementById('lbCopy')?.addEventListener('click', _copyPrompt);
  document.getElementById('lbFill')?.addEventListener('click', _fill);
  document.getElementById('lbFav')?.addEventListener('click', _toggleFav);
  document.getElementById('lbDelete')?.addEventListener('click', _delete);
  document.getElementById('lbToggleMeta')?.addEventListener('click', _toggleMeta);

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (!lbRoot.classList.contains('active')) return;
    switch (e.key) {
      case 'Escape':   close(); e.preventDefault(); break;
      case 'ArrowLeft':  navigate(-1); e.preventDefault(); break;
      case 'ArrowRight': navigate(1);  e.preventDefault(); break;
      case 'd': case 'D': _download(); break;
      case 'c': case 'C': _copyPrompt(); break;
      case 'r': case 'R': _fill(); break;
      case 'f': case 'F': _toggleFav(); break;
      case 'i': case 'I': _toggleMeta(); break;
      case 'Delete':     _delete(); break;
    }
  });
}

// ============================================================
// 打开 / 关闭
// ============================================================

/**
 * 打开 Lightbox，显示指定 path 的图片。
 * @param {string} path - 图片相对路径，如 "2026-04-15/140703_636473557.png"
 * @param {Array} images - 当前可浏览的图片元数据数组
 */
export function open(path, images) {
  currentImages = images;
  currentIndex = images.findIndex(i => `${i.date}/${i.filename}` === path);
  if (currentIndex < 0) currentIndex = 0;

  _show(currentIndex);
  lbRoot.classList.add('active');
}

export function close() {
  lbRoot.classList.remove('active');
  lbImg.src = '';
}

export function navigate(dir) {
  if (currentImages.length === 0) return;
  currentIndex += dir;
  if (currentIndex < 0) currentIndex = currentImages.length - 1;
  if (currentIndex >= currentImages.length) currentIndex = 0;
  _show(currentIndex);
}

// ============================================================
// 内部渲染
// ============================================================

function _show(idx) {
  const img = currentImages[idx];
  if (!img) return;

  const relPath = `${img.date}/${img.filename}`;
  const fullUrl = `/api/image?path=${encodeURIComponent(relPath)}`;
  lbImg.src = fullUrl;

  // 元数据
  if (lbPrompt) {
    lbPrompt.textContent = img.prompt || '(无 prompt)';
  }
  if (lbParams) {
    lbParams.innerHTML = `
      <span>Seed: ${img.seed ?? '?'}</span>
      <span>${img.width}×${img.height}</span>
      <span>${img.steps} steps</span>
      <span>CFG: ${img.cfg_scale ?? '?'}</span>
      <span>${(img.generation_time || 0).toFixed(1)}s</span>
    `;
  }

  // 缩略图导航条
  if (lbThumbstrip) {
    // 只显示当前图片前后各 5 张，避免 DOM 过多
    const start = Math.max(0, idx - 5);
    const end = Math.min(currentImages.length, idx + 6);
    lbThumbstrip.innerHTML = '';
    for (let i = start; i < end; i++) {
      const ti = currentImages[i];
      const tp = `${ti.date}/${ti.filename}`;
      const thumbUrl = `/api/image?path=${encodeURIComponent(tp)}&thumb=1`;
      const thumb = document.createElement('img');
      thumb.src = thumbUrl;
      thumb.className = i === idx ? 'active' : '';
      thumb.addEventListener('click', () => { currentIndex = i; _show(i); });
      lbThumbstrip.appendChild(thumb);
    }
  }
}

// ============================================================
// 工具栏操作
// ============================================================

function _download() {
  const img = currentImages[currentIndex];
  if (!img) return;
  const relPath = `${img.date}/${img.filename}`;
  const a = document.createElement('a');
  a.href = `/api/image?path=${encodeURIComponent(relPath)}`;
  a.download = img.filename;
  a.click();
}

function _copyPrompt() {
  const img = currentImages[currentIndex];
  if (!img?.prompt) return;
  navigator.clipboard.writeText(img.prompt).then(() => {
    showToast('✅ Prompt 已复制', 'success');
  });
}

function _fill() {
  const img = currentImages[currentIndex];
  if (img && onFillGenerator) {
    onFillGenerator(img);
    close();
  }
}

async function _toggleFav() {
  const img = currentImages[currentIndex];
  if (!img) return;
  const relPath = `${img.date}/${img.filename}`;
  try {
    const resp = await fetch('/api/image/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, favorited: !img.favorited }),
    });
    if (resp.ok) {
      img.favorited = !img.favorited;
      const btn = document.getElementById('lbFav');
      if (btn) btn.textContent = img.favorited ? '★' : '☆';
    }
  } catch (err) {
    showToast('收藏失败', 'error');
  }
}

async function _delete() {
  const img = currentImages[currentIndex];
  if (!img) return;
  if (!confirm('确定删除这张图片？')) return;
  showToast('删除功能待实现', 'info');
  // TODO: 调用后端删除 API
}

function _toggleMeta() {
  metaExpanded = !metaExpanded;
  const meta = document.getElementById('lbMeta');
  if (meta) meta.style.display = metaExpanded ? 'block' : 'none';
}
