/**
 * AnimaImagine 前端主入口。
 * Phase 1.1: 初始化所有模块、加载标签数据。
 */

import { loadTagData } from './tag-data.js';
import * as galleryView from './gallery-view.js';
import * as generator from './generator.js';
import * as lightbox from './lightbox.js';

// ============================================================
// 页面加载后初始化
// ============================================================

// 异步加载标签数据（不阻塞页面渲染）
loadTagData();

// 初始化生图面板
generator.init();

// 初始化 Lightbox
lightbox.init({
  onFillGenerator: (img) => generator.fillFromMeta(img),
});

// 初始化画廊视图
galleryView.init({
  onOpenLightbox: (path, images) => lightbox.open(path, galleryView.getFilteredImages()),
  onFillGenerator: (img) => generator.fillFromMeta(img),
});

// 设置画廊事件委托
galleryView.setupGalleryEvents();

// 全局快捷键（Phase 5）
document.addEventListener('keydown', (e) => {
  // G 键切换生图面板
  if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const active = document.activeElement;
    // 不在输入框中时才触发
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    document.getElementById('toggleGenerator')?.click();
  }

  // / 键聚焦到 prompt 输入框
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    e.preventDefault();
    // 确保面板可见
    const panel = document.getElementById('generatorPanel');
    if (panel && panel.style.display === 'none') panel.style.display = 'flex';
    document.getElementById('basicPrompt')?.focus();
  }
});
