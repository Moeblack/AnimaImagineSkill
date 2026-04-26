/**
 * AnimaImagine v2 画廊视图模块。
 *
 * v2 变更：
 * - 批量删除实际调用后端 API（不再是 TODO）
 * - 删除后自动移除卡片 DOM
 * - 收藏状态同步到 allImages 数据
 * - 不再被 generator.js 直接 import loadData（通过事件解耦）
 */

import { tagClass, escapeHtml, showToast } from './utils.js';

// ============================================================
// 状态
// ============================================================

let allImages = [];
const imageByPath = new Map();
let selectMode = false;
const selectedPaths = new Set();
let lastSelectedIndex = -1;

let galleryEl, datePickerEl, tagFilterEl, statsEl;
let loadStatusEl = null;
let onOpenLightbox = null;
let onFillGenerator = null;

// 前端性能优化：把图库拆成分页请求和分帧渲染，目的在于避免首屏一次拉取 2000 张并同步写入 DOM。
// PAGE_SIZE 控制网络和 JSON 解析批量，RENDER_CHUNK_SIZE 控制每一帧插入的卡片数量。
const PAGE_SIZE = 120;
const RENDER_CHUNK_SIZE = 36;
const FILTER_DEBOUNCE_MS = 180;

let totalImages = 0;
let nextOffset = 0;
let hasMore = true;
let isLoading = false;
let requestVersion = 0;
let filterTimer = 0;

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.closest?.('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// ============================================================
// 初始化
// ============================================================

export function init(options = {}) {
  galleryEl = document.getElementById('gallery');
  datePickerEl = document.getElementById('datePicker');
  tagFilterEl = document.getElementById('tagFilter');
  statsEl = document.getElementById('stats');

  onOpenLightbox = options.onOpenLightbox || null;
  onFillGenerator = options.onFillGenerator || null;

  datePickerEl.addEventListener('change', () => loadData());
  tagFilterEl.addEventListener('input', scheduleGalleryReload);

  _initSelectMode();
  _initIncrementalLoader();
  loadData();
}

// ============================================================
// 数据加载
// ============================================================

export async function loadData() {
  // 前端性能优化：每次显式刷新都重建分页游标，目的在于让日期/标签筛选从第一页重新按需加载。
  requestVersion += 1;
  allImages = [];
  imageByPath.clear();
  totalImages = 0;
  nextOffset = 0;
  hasMore = true;
  isLoading = false;
  galleryEl.innerHTML = '<div class="loading">正在寻找精美画作...</div>';
  statsEl.textContent = '';
  _updateLoadStatus('正在加载...');
  await loadNextPage(requestVersion);
}

function scheduleGalleryReload() {
  // 前端性能优化：输入框变化会连续触发，用短延迟合并请求，目的在于减少无意义的网络和重绘。
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => loadData(), FILTER_DEBOUNCE_MS);
}

async function loadNextPage(version = requestVersion) {
  if (isLoading || !hasMore) return;
  isLoading = true;
  _updateLoadStatus('正在加载...');
  try {
    const query = _buildImageQuery();
    query.set('limit', String(PAGE_SIZE));
    query.set('offset', String(nextOffset));
    const resp = await fetch(`/api/images?${query.toString()}`);
    if (resp.status === 401) { window.location.href = '/login'; return; }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (version !== requestVersion) return;

    // 填充日期选择器
    const dates = data.dates || [];
    const currentPickerVal = datePickerEl.value;
    datePickerEl.innerHTML = '<option value="">全部日期</option>' +
      dates.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    datePickerEl.value = currentPickerVal;

    if (nextOffset === 0) {
      galleryEl.innerHTML = '';
    }

    totalImages = data.total || 0;
    const pageImages = data.images || [];
    _rememberImages(pageImages);
    nextOffset += pageImages.length;
    hasMore = nextOffset < totalImages && pageImages.length > 0;

    if (allImages.length === 0) {
      galleryEl.innerHTML = '<div class="empty">还没有图片，快去生图面板生成吧！</div>';
    } else if (pageImages.length > 0) {
      await appendCardsChunked(pageImages, false, version);
    }
    // 前端性能优化：分帧渲染期间可能发生新筛选；版本变更后停止旧批次更新统计，目的在于避免状态回写串台。
    if (version !== requestVersion) return;
    _updateStats();
  } catch (err) {
    if (version === requestVersion && allImages.length === 0) {
      galleryEl.innerHTML = `<div class="empty">加载失败: ${err.message}</div>`;
    }
  } finally {
    if (version === requestVersion) {
      isLoading = false;
      _updateLoadStatus();
    }
  }
}

function _buildImageQuery() {
  // 前端性能优化：日期和标签直接成为 API 查询参数，目的在于让后端在分页之前裁剪数据集。
  const query = new URLSearchParams();
  const date = datePickerEl.value;
  const tag = tagFilterEl.value.trim();
  if (date) query.set('date', date);
  if (tag) query.set('tag', tag);
  return query;
}

function _rememberImages(images) {
  // 前端性能优化：维护 path -> image 索引，目的在于收藏、回填、批量复制不再反复线性扫描当前页数组。
  for (const img of images) {
    const path = imagePath(img);
    allImages.push(img);
    imageByPath.set(path, img);
  }
}

// ============================================================
// 过滤与渲染
// ============================================================

function _initIncrementalLoader() {
  // 前端性能优化：用 IntersectionObserver 在接近底部时加载下一页，目的在于用浏览行为驱动网络请求。
  loadStatusEl = document.createElement('div');
  loadStatusEl.className = 'gallery-load-status';
  galleryEl.after(loadStatusEl);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      void loadNextPage();
    }
  }, { rootMargin: '900px 0px' });
  observer.observe(loadStatusEl);
}

async function appendCardsChunked(images, isFlash = false, version = requestVersion) {
  // 前端性能优化：分帧追加卡片，目的在于把大批 DOM 写入拆开，避免一次渲染阻塞主线程。
  for (let i = 0; i < images.length; i += RENDER_CHUNK_SIZE) {
    if (version !== requestVersion) return;
    const chunk = images.slice(i, i + RENDER_CHUNK_SIZE);
    galleryEl.insertAdjacentHTML('beforeend', chunk.map(img => renderCard(img, isFlash)).join(''));
    if (i + RENDER_CHUNK_SIZE < images.length) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
}

function _updateStats() {
  // 前端性能优化：统计展示已加载/总量，目的在于让分页加载状态对用户可见。
  statsEl.textContent = totalImages > allImages.length
    ? `${allImages.length}/${totalImages} 张图片`
    : `${totalImages} 张图片`;
}

function _updateLoadStatus(text = '') {
  // 前端性能优化：底部状态同时是滚动加载哨兵，目的在于无需额外滚动监听。
  if (text) {
    loadStatusEl.textContent = text;
  } else if (hasMore) {
    loadStatusEl.textContent = `继续向下滚动加载更多（${allImages.length}/${totalImages}）`;
  } else if (totalImages > 0) {
    loadStatusEl.textContent = `已加载全部 ${totalImages} 张`;
  } else {
    loadStatusEl.textContent = '';
  }
}

function imagePath(img) {
  return `${img.date || ''}/${img.filename || ''}`;
}

function renderCard(img, isFlash = false) {
  const date = img.date || '';
  const fn = img.filename || '';
  const relPath = imagePath(img);
  const thumbUrl = `/api/image?path=${encodeURIComponent(relPath)}&thumb=1`;
  const fullUrl = `/api/image?path=${encodeURIComponent(relPath)}`;
  const tags = (img.tags || []).slice(0, 20);
  const tagsHtml = tags.map(t =>
    `<span class="tag ${tagClass(t)}" data-tag="${escapeHtml(t)}" title="${escapeHtml(t)}">${escapeHtml(t)}</span>`
  ).join('');
  const isFav = img.favorited ? ' favorited' : '';
  const favText = img.favorited ? '★' : '☆';

  return `
    <div class="card ${isFlash ? 'flash' : ''}" data-path="${escapeHtml(relPath)}">
      <div class="card-checkbox" data-path="${escapeHtml(relPath)}"></div>
      <button class="card-fav${isFav}" data-path="${escapeHtml(relPath)}" title="收藏">${favText}</button>
      <img src="${thumbUrl}" alt="" loading="lazy" decoding="async" width="${img.width}" height="${img.height}" data-full="${fullUrl}" />
      <div class="card-actions">
        <button class="card-action-btn" data-action="download" data-url="${fullUrl}" title="下载">⬇</button>
        <button class="card-action-btn" data-action="copy" data-prompt="${escapeHtml(img.prompt || '')}" title="复制 Prompt">📋</button>
        <button class="card-action-btn" data-action="fill" data-path="${escapeHtml(relPath)}" title="回填参数">🔄</button>
        <button class="card-action-btn" data-action="delete" data-path="${escapeHtml(relPath)}" title="删除">🗑</button>
      </div>
      <div class="info">
        <div class="tags">${tagsHtml}</div>
        <div class="meta-line">
          <span>seed: ${img.seed ?? '?'}</span>
          <span>${img.width}×${img.height}</span>
          <span>${img.steps}steps</span>
          <span>${(img.generation_time || 0).toFixed(1)}s</span>
          <span>${date}</span>
        </div>
      </div>
    </div>`;
}

// ============================================================
// 事件委托
// ============================================================

export function setupGalleryEvents() {
  galleryEl.addEventListener('click', (e) => {
    const tagEl = e.target.closest('.tag');
    if (tagEl) {
      tagFilterEl.value = tagEl.dataset.tag || tagEl.textContent;
      // 前端性能优化：点击标签也走后端 tag 查询，目的在于保持分页前过滤而不是本地全量重绘。
      void loadData();
      return;
    }

    const favBtn = e.target.closest('.card-fav');
    if (favBtn) {
      e.stopPropagation();
      _toggleFavorite(favBtn);
      return;
    }

    const actionBtn = e.target.closest('.card-action-btn');
    if (actionBtn) {
      e.stopPropagation();
      _handleCardAction(actionBtn);
      return;
    }

    const checkbox = e.target.closest('.card-checkbox');
    if (checkbox && selectMode) {
      e.stopPropagation();
      _toggleCardSelection(checkbox, e);
      return;
    }

    if (selectMode) {
      const card = e.target.closest('.card');
      if (card) {
        const cb = card.querySelector('.card-checkbox');
        if (cb) _toggleCardSelection(cb, e);
        return;
      }
    }

    const img = e.target.closest('.card img');
    if (img && onOpenLightbox) {
      const card = img.closest('.card');
      const path = card?.dataset.path;
      if (path) onOpenLightbox(path, allImages);
    }
  });

  // 长按进入选择模式
  let longPressTimer = null;
  galleryEl.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card');
    if (!card || selectMode) return;
    longPressTimer = setTimeout(() => {
      _enterSelectMode();
      const cb = card.querySelector('.card-checkbox');
      if (cb) _toggleCardSelection(cb, e);
    }, 500);
  });
  galleryEl.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  galleryEl.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
}

// ============================================================
// 卡片操作
// ============================================================

async function _toggleFavorite(btn) {
  const path = btn.dataset.path;
  const isFav = btn.classList.contains('favorited');
  try {
    const resp = await fetch('/api/image/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, favorited: !isFav }),
    });
    if (resp.ok) {
      btn.classList.toggle('favorited');
      btn.textContent = btn.classList.contains('favorited') ? '★' : '☆';
      // 前端性能优化：通过 path 索引同步收藏状态，目的在于避免每次收藏都线性扫描已加载图片。
      const img = imageByPath.get(path);
      if (img) img.favorited = !isFav;
    }
  } catch (err) {
    showToast('收藏失败: ' + err.message, 'error');
  }
}

function _handleCardAction(btn) {
  const action = btn.dataset.action;
  switch (action) {
    case 'download': {
      const a = document.createElement('a');
      a.href = btn.dataset.url;
      a.download = '';
      a.click();
      break;
    }
    case 'copy': {
      navigator.clipboard.writeText(btn.dataset.prompt).then(() => {
        showToast('✅ Prompt 已复制到剪贴板', 'success');
      });
      break;
    }
    case 'fill': {
      const path = btn.dataset.path;
      // 前端性能优化：回填按钮使用 path 索引取图，目的在于让操作成本不随已加载卡片数增长。
      const img = imageByPath.get(path);
      if (img && onFillGenerator) onFillGenerator(img);
      break;
    }
    // v2: 单张删除（从卡片操作栏）
    case 'delete': {
      const path = btn.dataset.path;
      if (confirm('确定删除这张图片？')) {
        _deleteImages([path]);
      }
      break;
    }
  }
}

/**
 * v2: 调用后端 API 删除图片 + 移除卡片 DOM。
 * 解决 v1 中删除按钮存在但实际是 TODO 的问题。
 */
async function _deleteImages(paths) {
  try {
    const resp = await fetch('/api/image/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const deletedPaths = new Set((data.deleted || []).map(id => `${id}.png`));
      // 前端性能优化：删除后同步维护数组、索引和分页游标，目的在于不依赖下一次全量刷新修正状态。
      allImages = allImages.filter(img => !deletedPaths.has(imagePath(img)));
      for (const path of deletedPaths) {
        imageByPath.delete(path);
        selectedPaths.delete(path);
        const card = galleryEl.querySelector(`.card[data-path="${CSS.escape(path)}"]`);
        if (card) card.remove();
      }
      totalImages = Math.max(0, totalImages - deletedPaths.size);
      nextOffset = allImages.length;
      _updateStats();
      _updateLoadStatus();
      showToast(`✅ 已删除 ${data.count || paths.length} 张`, 'success');
    }
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

// ============================================================
// 批量选择模式
// ============================================================

function _initSelectMode() {
  document.getElementById('selClose')?.addEventListener('click', _exitSelectMode);
  document.getElementById('selAll')?.addEventListener('click', _selectAll);
  document.getElementById('selDownload')?.addEventListener('click', _batchDownload);
  document.getElementById('selCopy')?.addEventListener('click', _batchCopy);
  document.getElementById('selDelete')?.addEventListener('click', _batchDelete);
  document.getElementById('enterSelectMode')?.addEventListener('click', _enterSelectMode);

  document.addEventListener('keydown', (e) => {
    if (!selectMode) return;
    if (isEditableTarget(document.activeElement)) return;
    if (e.key === 'Escape') { _exitSelectMode(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      _selectAll();
    }
  });
}

function _enterSelectMode() {
  selectMode = true;
  document.body.classList.add('select-mode');
  _updateSelectCount();
}

function _exitSelectMode() {
  selectMode = false;
  selectedPaths.clear();
  lastSelectedIndex = -1;
  document.body.classList.remove('select-mode');
  document.querySelectorAll('.card-checkbox.checked').forEach(cb => {
    cb.classList.remove('checked');
    cb.textContent = '';
  });
  document.querySelectorAll('.card.selected-card').forEach(c => c.classList.remove('selected-card'));
}

function _toggleCardSelection(checkbox, event) {
  const path = checkbox.dataset.path;
  const card = checkbox.closest('.card');

  if (event.shiftKey && lastSelectedIndex >= 0) {
    const cards = Array.from(galleryEl.querySelectorAll('.card'));
    const currentIndex = cards.indexOf(card);
    if (currentIndex >= 0) {
      const start = Math.min(lastSelectedIndex, currentIndex);
      const end = Math.max(lastSelectedIndex, currentIndex);
      for (let i = start; i <= end; i++) {
        const cb = cards[i].querySelector('.card-checkbox');
        const p = cb?.dataset.path;
        if (p && !selectedPaths.has(p)) {
          selectedPaths.add(p);
          cb.classList.add('checked');
          cb.textContent = '✓';
          cards[i].classList.add('selected-card');
        }
      }
      _updateSelectCount();
      return;
    }
  }

  if (selectedPaths.has(path)) {
    selectedPaths.delete(path);
    checkbox.classList.remove('checked');
    checkbox.textContent = '';
    card.classList.remove('selected-card');
  } else {
    selectedPaths.add(path);
    checkbox.classList.add('checked');
    checkbox.textContent = '✓';
    card.classList.add('selected-card');
  }

  const cards = Array.from(galleryEl.querySelectorAll('.card'));
  lastSelectedIndex = cards.indexOf(card);
  _updateSelectCount();
  if (selectedPaths.size === 0) _exitSelectMode();
}

function _selectAll() {
  galleryEl.querySelectorAll('.card').forEach(card => {
    const cb = card.querySelector('.card-checkbox');
    const path = cb?.dataset.path;
    if (path) {
      selectedPaths.add(path);
      cb.classList.add('checked');
      cb.textContent = '✓';
      card.classList.add('selected-card');
    }
  });
  _updateSelectCount();
}

function _updateSelectCount() {
  const el = document.getElementById('selCount');
  if (el) el.textContent = `已选 ${selectedPaths.size} 张`;
}

async function _batchDownload() {
  if (selectedPaths.size === 0) return;
  if (selectedPaths.size <= 5) {
    for (const path of selectedPaths) {
      const a = document.createElement('a');
      a.href = `/api/image?path=${encodeURIComponent(path)}`;
      a.download = '';
      a.click();
      await new Promise(r => setTimeout(r, 200));
    }
  } else {
    showToast(`批量下载 ${selectedPaths.size} 张，请稍候...`, 'info');
    for (const path of selectedPaths) {
      const a = document.createElement('a');
      a.href = `/api/image?path=${encodeURIComponent(path)}`;
      a.download = '';
      a.click();
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

function _batchCopy() {
  if (selectedPaths.size === 0) return;
  const prompts = [];
  for (const path of selectedPaths) {
    // 前端性能优化：批量复制复用 path 索引，目的在于选中数量增大时仍保持直接查找。
    const img = imageByPath.get(path);
    if (img?.prompt) prompts.push(img.prompt);
  }
  navigator.clipboard.writeText(prompts.join('\n\n')).then(() => {
    showToast(`✅ 已复制 ${prompts.length} 条 Prompt`, 'success');
  });
}

// v2: 批量删除实际调用后端 API（不再是 TODO）
async function _batchDelete() {
  if (selectedPaths.size === 0) return;
  if (!confirm(`确定删除 ${selectedPaths.size} 张图片？`)) return;
  await _deleteImages(Array.from(selectedPaths));
  _exitSelectMode();
}

// ============================================================
// 导出
// ============================================================

export function getFilteredImages() {
  // 前端性能优化：当前 allImages 已由后端按日期/标签过滤并分页，Lightbox 直接使用已加载窗口。
  return allImages;
}
