/**
 * AnimaImagine v2.3 Lightbox 模块。
 *
 * v2.3 变更：
 * - 滚轮缩放 + 双击切换原始/适应 + 拖拽平移
 * - UI 自动隐藏（鼠标活动时淡入）
 * - 缩略图条独立固定在底部
 * - 缩放比例指示器
 */

import { escapeHtml, showToast } from './utils.js';

let currentImages = [];
let currentIndex = -1;
let metaExpanded = true;
let onFillGenerator = null;

let lbRoot, lbImg, lbImgWrap, lbPrompt, lbNegPrompt, lbParams, lbThumbstrip, lbZoomLabel;

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.closest?.('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// ============================================================
// 缩放/平移状态
// ============================================================
let scale = 1;
let panX = 0, panY = 0;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let panStartX = 0, panStartY = 0;
const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.15; // 每次滚轮缩放倍率

export function init(options = {}) {
  onFillGenerator = options.onFillGenerator || null;

  lbRoot = document.getElementById('lightbox');
  lbImg = document.getElementById('lightboxImg');
  lbImgWrap = document.getElementById('lbImgWrap');
  lbPrompt = document.getElementById('lbPrompt');
  lbNegPrompt = document.getElementById('lbNegPrompt');
  lbParams = document.getElementById('lbParams');
  lbThumbstrip = document.getElementById('lbThumbstrip');
  lbZoomLabel = document.getElementById('lbZoomLabel');

  document.getElementById('lbClose')?.addEventListener('click', close);
  // 【v2.3】点击背景关闭改为：只有未缩放时点击背景才关闭
  lbImgWrap.addEventListener('click', (e) => {
    if (e.target === lbImgWrap && scale <= 1.01) close();
  });

  document.getElementById('lbPrev')?.addEventListener('click', () => navigate(-1));
  document.getElementById('lbNext')?.addEventListener('click', () => navigate(1));

  document.getElementById('lbDownload')?.addEventListener('click', _download);
  document.getElementById('lbCopy')?.addEventListener('click', _copyPrompt);
  document.getElementById('lbFill')?.addEventListener('click', _fill);
  document.getElementById('lbFav')?.addEventListener('click', _toggleFav);
  document.getElementById('lbDelete')?.addEventListener('click', _delete);
  document.getElementById('lbToggleMeta')?.addEventListener('click', _toggleMeta);

  document.addEventListener('keydown', (e) => {
    if (!lbRoot.classList.contains('active')) return;
    if (isEditableTarget(document.activeElement)) return;
    switch (e.key) {
      case 'Escape':     close(); e.preventDefault(); break;
      case 'ArrowLeft':  navigate(-1); e.preventDefault(); break;
      case 'ArrowRight': navigate(1);  e.preventDefault(); break;
      case 'd': case 'D': _download(); break;
      case 'c': case 'C': _copyPrompt(); break;
      case 'r': case 'R': _fill(); break;
      case 'f': case 'F': _toggleFav(); break;
      case 'i': case 'I': _toggleMeta(); break;
      case 'Delete':     _delete(); break;
      // 【v2.3】键盘缩放：+ 放大、- 缩小、0 复位
      case '+': case '=': _zoomAtCenter(ZOOM_STEP); break;
      case '-':           _zoomAtCenter(1 / ZOOM_STEP); break;
      case '0':           _resetZoom(); break;
    }
  });

  _initUIAutoHide();
  _initZoomPan();
  // 【v3.0】手机端 touch 手势：滑动切换、双指缩放、防后退
  _initTouchGestures();
}

// ============================================================
// UI 自动隐藏
// ============================================================
let _uiTimer = 0;
const UI_HIDE_DELAY = 2000;

function _showUI() {
  lbRoot.classList.add('ui-visible');
  clearTimeout(_uiTimer);
  _uiTimer = setTimeout(() => lbRoot.classList.remove('ui-visible'), UI_HIDE_DELAY);
}

function _initUIAutoHide() {
  lbRoot.addEventListener('mousemove', _showUI);
  lbRoot.addEventListener('click', _showUI);
  // 【v3.0】手机端也需要 touch 触发 UI 显示
  lbRoot.addEventListener('touchstart', _showUI);
}

// ============================================================
// 缩放 & 平移
// 【v2.3 新增】滚轮缩放以鼠标位置为锚点，双击切换原始/适应，
// 缩放后可拖拽平移查看细节。
// ============================================================
function _initZoomPan() {
  // 滚轮缩放，以鼠标位置为锚点
  lbImgWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    _zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  // 双击：切换「适应屏幕 ↔ 原始尺寸」
  lbImgWrap.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (scale > 1.01) {
      // 已放大 → 复位
      _resetZoom();
    } else {
      // 适应 → 放大到原始像素尺寸，以双击位置为锚点
      const naturalScale = _getNaturalScale();
      if (naturalScale > 1.05) {
        _zoomAt(e.clientX, e.clientY, naturalScale / scale);
      } else {
        // 原始尺寸比屏幕还小，放大到 2x
        _zoomAt(e.clientX, e.clientY, 2 / scale);
      }
    }
  });

  // 拖拽平移
  lbImgWrap.addEventListener('pointerdown', (e) => {
    if (scale <= 1.01) return; // 未缩放时不拖拽
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    lbImgWrap.classList.add('dragging');
    lbImgWrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  lbImgWrap.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    _applyTransform();
  });

  lbImgWrap.addEventListener('pointerup', _endDrag);
  lbImgWrap.addEventListener('pointercancel', _endDrag);
}

function _endDrag() {
  isDragging = false;
  lbImgWrap.classList.remove('dragging');
}

/** 以屏幕坐标 (cx, cy) 为锚点缩放 */
function _zoomAt(cx, cy, factor) {
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
  if (newScale === scale) return;

  // 计算图片在 wrap 中的位置
  const rect = lbImg.getBoundingClientRect();
  // 鼠标在图片上的相对位置（缩放前）
  const imgX = (cx - rect.left) / scale;
  const imgY = (cy - rect.top) / scale;

  // 缩放后，该点应该还在鼠标下
  panX += imgX * (scale - newScale);
  panY += imgY * (scale - newScale);
  scale = newScale;

  _applyTransform();
  _updateZoomUI();
}

/** 以视口中心为锚点缩放（键盘用） */
function _zoomAtCenter(factor) {
  const wrapRect = lbImgWrap.getBoundingClientRect();
  _zoomAt(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2, factor);
}

/** 回到适应屏幕 */
function _resetZoom() {
  scale = 1;
  panX = 0;
  panY = 0;
  _applyTransform();
  _updateZoomUI();
}

/** 计算原始像素尺寸相对于当前适应尺寸的比例 */
function _getNaturalScale() {
  if (!lbImg.naturalWidth) return 1;
  const displayW = lbImg.clientWidth;
  const displayH = lbImg.clientHeight;
  if (!displayW || !displayH) return 1;
  return Math.max(lbImg.naturalWidth / displayW, lbImg.naturalHeight / displayH);
}

function _applyTransform() {
  lbImg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  lbImgWrap.classList.toggle('zoomed', scale > 1.01);
}

function _updateZoomUI() {
  if (lbZoomLabel) {
    const pct = Math.round(scale * 100);
    lbZoomLabel.textContent = scale > 1.01 ? `${pct}%` : '';
  }
}

// ============================================================
// 打开 / 关闭 / 导航
// ============================================================
export function open(path, images) {
  currentImages = images;
  currentIndex = images.findIndex(i => `${i.date}/${i.filename}` === path);
  if (currentIndex < 0) currentIndex = 0;
  _resetZoom();
  _show(currentIndex);
  lbRoot.classList.add('active');
  // 【v3.0】阻止手机端浏览器后退手势和默认 touch 行为
  document.body.style.overscrollBehavior = 'none';
  lbImgWrap.style.touchAction = 'none';
  // 【v2.3】打开时默认不显示元数据，需要手动按 ℹ
  metaExpanded = false;
  lbRoot.classList.remove('meta-visible');
}

export function close() {
  lbRoot.classList.remove('active');
  // 【v3.0】恢复 touch 行为
  document.body.style.overscrollBehavior = '';
  lbImgWrap.style.touchAction = '';
  lbRoot.classList.remove('ui-visible');
  lbRoot.classList.remove('meta-visible');
  clearTimeout(_uiTimer);
  _resetZoom();
  lbImg.src = '';
}

export function navigate(dir) {
  if (currentImages.length === 0) return;
  currentIndex += dir;
  if (currentIndex < 0) currentIndex = currentImages.length - 1;
  if (currentIndex >= currentImages.length) currentIndex = 0;
  _resetZoom();
  _show(currentIndex);
}

function _show(idx) {
  const img = currentImages[idx];
  if (!img) return;

  const relPath = `${img.date}/${img.filename}`;
  lbImg.src = `/api/image?path=${encodeURIComponent(relPath)}`;

  if (lbPrompt) lbPrompt.textContent = img.prompt || '(无 prompt)';
  if (lbNegPrompt) {
    const neg = img.negative_prompt || '';
    lbNegPrompt.textContent = neg ? `⛔ ${neg}` : '';
    lbNegPrompt.style.display = neg ? 'block' : 'none';
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

  const favBtn = document.getElementById('lbFav');
  if (favBtn) favBtn.textContent = img.favorited ? '★' : '☆';

  if (lbThumbstrip) {
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
      thumb.addEventListener('click', () => { currentIndex = i; _resetZoom(); _show(i); });
      lbThumbstrip.appendChild(thumb);
    }
  }
}

// ============================================================
// 操作
// ============================================================
function _download() {
  const img = currentImages[currentIndex];
  if (!img) return;
  const a = document.createElement('a');
  a.href = `/api/image?path=${encodeURIComponent(`${img.date}/${img.filename}`)}`;
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
      const cardFav = document.querySelector(`.card-fav[data-path="${CSS.escape(relPath)}"]`);
      if (cardFav) {
        cardFav.classList.toggle('favorited', img.favorited);
        cardFav.textContent = img.favorited ? '★' : '☆';
      }
    }
  } catch (err) {
    showToast('收藏失败', 'error');
  }
}

async function _delete() {
  const img = currentImages[currentIndex];
  if (!img) return;
  if (!confirm('确定删除这张图片？')) return;

  const relPath = `${img.date}/${img.filename}`;
  try {
    const resp = await fetch('/api/image/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [relPath] }),
    });
    if (resp.ok) {
      showToast('✅ 已删除', 'success');
      currentImages.splice(currentIndex, 1);
      const card = document.querySelector(`.card[data-path="${CSS.escape(relPath)}"]`);
      if (card) card.remove();
      if (currentImages.length === 0) {
        close();
      } else {
        if (currentIndex >= currentImages.length) currentIndex = 0;
        _show(currentIndex);
      }
    }
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

function _toggleMeta() {
  metaExpanded = !metaExpanded;
  // 【v2.3】用 class 控制元数据显示，点击 ℹ 按钮切换，不随鼠标自动出现
  lbRoot.classList.toggle('meta-visible', metaExpanded);
}


// ============================================================
// 【v3.0 新增】手机端 touch 手势
// - 单指左右滑动：未缩放时切换图片
// - 双指 pinch：缩放图片
// - 阻止浏览器默认后退手势（通过 preventDefault）
// ============================================================
let _touchStartX = 0, _touchStartY = 0, _touchStartTime = 0;
let _touchCount = 0;
let _pinchStartDist = 0, _pinchStartScale = 1;
let _isSwiping = false;

function _initTouchGestures() {
  lbImgWrap.addEventListener('touchstart', (e) => {
    _touchCount = e.touches.length;
    if (_touchCount === 1) {
      // 单指：记录起始位置，用于 swipe 检测
      _touchStartX = e.touches[0].clientX;
      _touchStartY = e.touches[0].clientY;
      _touchStartTime = Date.now();
      _isSwiping = false;
    } else if (_touchCount === 2) {
      // 双指：记录初始距离，用于 pinch-to-zoom
      _pinchStartDist = _getTouchDist(e.touches);
      _pinchStartScale = scale;
      e.preventDefault(); // 阻止浏览器默认缩放
    }
  }, { passive: false });

  lbImgWrap.addEventListener('touchmove', (e) => {
    e.preventDefault(); // 【v3.0】阻止浏览器后退手势和页面滚动

    if (e.touches.length === 2) {
      // 双指缩放
      const newDist = _getTouchDist(e.touches);
      if (_pinchStartDist > 0) {
        const factor = newDist / _pinchStartDist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        // 直接设置目标缩放比例，避免累积误差
        const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, _pinchStartScale * factor));
        if (Math.abs(targetScale - scale) > 0.01) {
          _zoomAt(midX, midY, targetScale / scale);
        }
      }
      return;
    }

    if (e.touches.length === 1 && scale <= 1.01) {
      // 单指未缩放：检测水平滑动距离
      const dx = e.touches[0].clientX - _touchStartX;
      if (Math.abs(dx) > 20) _isSwiping = true;
    }
  }, { passive: false });

  lbImgWrap.addEventListener('touchend', (e) => {
    if (_touchCount === 1 && scale <= 1.01) {
      // 单指 swipe 检测
      const dt = Date.now() - _touchStartTime;
      const endX = e.changedTouches[0].clientX;
      const dx = endX - _touchStartX;
      const dy = e.changedTouches[0].clientY - _touchStartY;
      // 水平位移 > 50px，耗时 < 500ms，且水平位移大于垂直位移
      if (Math.abs(dx) > 50 && dt < 500 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx > 0) navigate(-1); // 右滑 = 上一张
        else navigate(1);          // 左滑 = 下一张
      }
    }
    // 重置 pinch 状态
    _pinchStartDist = 0;
    _touchCount = 0;
    _isSwiping = false;
  });
}

/** 计算两个触摸点之间的距离 */
function _getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
