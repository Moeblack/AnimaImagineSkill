/**
 * AnimaImagine 画廊视图模块。
 * Phase 1.1: 从 gallery.html 抽出的画廊渲染、过滤、增量更新逻辑。
 * Phase 3.1: 新增卡片操作栏、收藏按钮、批量选择。
 */

import { tagClass, escapeHtml, showToast } from './utils.js';

// ============================================================
// 状态
// ============================================================

let allImages = [];       // 全量元数据缓存
let lastJsonString = '';  // 用于检测数据是否变化

// 批量选择模式状态
let selectMode = false;
const selectedPaths = new Set();
let lastSelectedIndex = -1; // 用于 Shift+Click 范围选择

// DOM 引用（在 init() 中设置）
let galleryEl, datePickerEl, tagFilterEl, statsEl;

// 外部回调（由 app.js 设置）
let onOpenLightbox = null;
let onFillGenerator = null;

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

  datePickerEl.addEventListener('change', () => applyFilter());
  tagFilterEl.addEventListener('input', () => applyFilter());

  // 批量选择模式初始化
  _initSelectMode();

  // 初始加载 + 定时刷新
  loadData();
  setInterval(loadData, 30000);
}

// ============================================================
// 数据加载
// ============================================================

export async function loadData() {
  if (allImages.length === 0) {
    galleryEl.innerHTML = '<div class="loading">正在寻找精美画作...</div>';
  }
  try {
    const resp = await fetch('/api/images');
    if (resp.status === 401) { window.location.href = '/login'; return; }
    const data = await resp.json();

    const currentJsonString = JSON.stringify(data.images);
    if (currentJsonString === lastJsonString) return;

    const newImages = data.images || [];
    const oldSet = new Set(allImages.map(i => i.filename));
    const addedImages = newImages.filter(i => !oldSet.has(i.filename));

    lastJsonString = currentJsonString;
    allImages = newImages;

    // 填充日期选择器
    const dates = data.dates || [];
    const currentPickerVal = datePickerEl.value;
    datePickerEl.innerHTML = '<option value="">全部日期</option>' +
      dates.map(d => `<option value="${d}">${d}</option>`).join('');
    datePickerEl.value = currentPickerVal;

    if (oldSet.size === 0 || addedImages.length === 0 || addedImages.length > 50) {
      applyFilter();
    } else {
      applyFilter(addedImages);
    }
  } catch (err) {
    if (allImages.length === 0) {
      galleryEl.innerHTML = `<div class="empty">加载失败: ${err.message}</div>`;
    }
  }
}

// ============================================================
// 过滤与渲染
// ============================================================

function applyFilter(addedImages = null) {
  const date = datePickerEl.value;
  const kw = tagFilterEl.value.trim().toLowerCase();

  if (addedImages) {
    let filteredNew = addedImages;
    if (date) filteredNew = filteredNew.filter(i => i.date === date);
    if (kw) filteredNew = filteredNew.filter(i =>
      (i.tags || []).some(t => t.toLowerCase().includes(kw))
    );
    if (filteredNew.length > 0) {
      const empty = galleryEl.querySelector('.empty');
      if (empty) empty.remove();
      const newHtmls = filteredNew.reverse().map(i => renderCard(i, true)).join('');
      galleryEl.insertAdjacentHTML('afterbegin', newHtmls);
    }
    statsEl.textContent = `${allImages.length} 张图片`;
  } else {
    let filtered = allImages;
    if (date) filtered = filtered.filter(i => i.date === date);
    if (kw) filtered = filtered.filter(i =>
      (i.tags || []).some(t => t.toLowerCase().includes(kw))
    );
    renderAll(filtered);
  }
}

function renderAll(images) {
  if (images.length === 0) {
    galleryEl.innerHTML = '<div class="empty">还没有图片，快去生图面板生成吧！</div>';
  } else {
    galleryEl.innerHTML = images.map(i => renderCard(i, false)).join('');
  }
  statsEl.textContent = `${images.length} 张图片`;
}

// ============================================================
// 卡片渲染（Phase 3.1: 新增操作栏、收藏、复选框）
// ============================================================

function renderCard(img, isFlash = false) {
  const date = img.date || '';
  const fn = img.filename || '';
  const relPath = `${date}/${fn}`;
  const thumbUrl = `/api/image?path=${encodeURIComponent(relPath)}&thumb=1`;
  const fullUrl = `/api/image?path=${encodeURIComponent(relPath)}`;

  const tags = (img.tags || []).slice(0, 20);
  const tagsHtml = tags.map(t =>
    `<span class="tag ${tagClass(t)}" data-tag="${escapeHtml(t)}" title="${escapeHtml(t)}">${escapeHtml(t)}</span>`
  ).join('');

  const isFav = img.favorited ? ' favorited' : '';

  return `
    <div class="card ${isFlash ? 'flash' : ''}" data-path="${escapeHtml(relPath)}">
      <div class="card-checkbox" data-path="${escapeHtml(relPath)}"></div>
      <button class="card-fav${isFav}" data-path="${escapeHtml(relPath)}" title="收藏">☆</button>
      <img src="${thumbUrl}" alt="" loading="lazy" data-full="${fullUrl}" />
      <div class="card-actions">
        <button class="card-action-btn" data-action="download" data-url="${fullUrl}" title="下载">⬇</button>
        <button class="card-action-btn" data-action="copy" data-prompt="${escapeHtml(img.prompt || '')}" title="复制 Prompt">📋</button>
        <button class="card-action-btn" data-action="fill" data-path="${escapeHtml(relPath)}" title="回填参数">🔄</button>
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
// 事件委托（统一在 gallery 容器上监听）
// ============================================================

export function setupGalleryEvents() {
  galleryEl.addEventListener('click', (e) => {
    // 标签点击过滤
    const tagEl = e.target.closest('.tag');
    if (tagEl) {
      tagFilterEl.value = tagEl.dataset.tag || tagEl.textContent;
      applyFilter();
      return;
    }

    // 收藏按钮
    const favBtn = e.target.closest('.card-fav');
    if (favBtn) {
      e.stopPropagation();
      _toggleFavorite(favBtn);
      return;
    }

    // 卡片操作栏按钮
    const actionBtn = e.target.closest('.card-action-btn');
    if (actionBtn) {
      e.stopPropagation();
      _handleCardAction(actionBtn);
      return;
    }

    // 批量选择模式下的复选框
    const checkbox = e.target.closest('.card-checkbox');
    if (checkbox && selectMode) {
      e.stopPropagation();
      _toggleCardSelection(checkbox, e);
      return;
    }

 // 选择模式下点击卡片也切换选中
    if (selectMode) {
      const card = e.target.closest('.card');
      if (card) {
        const cb = card.querySelector('.card-checkbox');
        if (cb) _toggleCardSelection(cb, e);
        return;
      }
    }

    // 普通模式：点击图片打开 Lightbox
    const img = e.target.closest('.card img');
    if (img && onOpenLightbox) {
      const card = img.closest('.card');
      const path = card?.dataset.path;
      if (path) onOpenLightbox(path, allImages);
    }
  });

  // 长按进入选择模式（移动端）
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
      const prompt = btn.dataset.prompt;
      navigator.clipboard.writeText(prompt).then(() => {
        showToast('✅ Prompt 已复制到剪贴板', 'success');
      });
      break;
    }
    case 'fill': {
      const path = btn.dataset.path;
      const img = allImages.find(i => `${i.date}/${i.filename}` === path);
      if (img && onFillGenerator) onFillGenerator(img);
      break;
    }
  }
}

// ============================================================
// 批量选择模式（Phase 4.1）
// ============================================================

function _initSelectMode() {
  // 选择模式工具栏事件
  document.getElementById('selClose')?.addEventListener('click', _exitSelectMode);
  document.getElementById('selAll')?.addEventListener('click', _selectAll);
  document.getElementById('selDownload')?.addEventListener('click', _batchDownload);
  document.getElementById('selCopy')?.addEventListener('click', _batchCopy);
  document.getElementById('selDelete')?.addEventListener('click', _batchDelete);

  // header 上的“选择”按钮
  document.getElementById('enterSelectMode')?.addEventListener('click', _enterSelectMode);

  // Ctrl+A 全选 / Esc 退出
  document.addEventListener('keydown', (e) => {
    if (!selectMode) return;
    if (e.key === 'Escape') { _exitSelectMode(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
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
  // 清除所有选中状态
  document.querySelectorAll('.card-checkbox.checked').forEach(cb => {
    cb.classList.remove('checked');
    cb.textContent = '';
  });
  document.querySelectorAll('.card.selected-card').forEach(c => c.classList.remove('selected-card'));
}

function _toggleCardSelection(checkbox, event) {
  const path = checkbox.dataset.path;
  const card = checkbox.closest('.card');

  // Shift+Click 范围选择
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

  // 普通切换
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

  // 全部取消后自动退出
  if (selectedPaths.size === 0) _exitSelectMode();
}

function _selectAll() {
  const cards = galleryEl.querySelectorAll('.card');
  cards.forEach(card => {
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
  // 少量图片逐个触发下载
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
    // TODO: 后端打包下载 API
  }
}

function _batchCopy() {
  if (selectedPaths.size === 0) return;
  const prompts = [];
  for (const path of selectedPaths) {
    const img = allImages.find(i => `${i.date}/${i.filename}` === path);
    if (img?.prompt) prompts.push(img.prompt);
  }
  navigator.clipboard.writeText(prompts.join('\n\n')).then(() => {
    showToast(`✅ 已复制 ${prompts.length} 条 Prompt`, 'success');
  });
}

async function _batchDelete() {
  if (selectedPaths.size === 0) return;
  if (!confirm(`确定删除 ${selectedPaths.size} 张图片？`)) return;
  showToast(`正在删除 ${selectedPaths.size} 张...`, 'info');
  // TODO: 调用后端删除 API
  _exitSelectMode();
}

// ============================================================
// 导出当前过滤后的图片列表（供 Lightbox 用）
// ============================================================

export function getFilteredImages() {
  const date = datePickerEl.value;
  const kw = tagFilterEl.value.trim().toLowerCase();
  let filtered = allImages;
  if (date) filtered = filtered.filter(i => i.date === date);
  if (kw) filtered = filtered.filter(i =>
    (i.tags || []).some(t => t.toLowerCase().includes(kw))
  );
  return filtered;
}
