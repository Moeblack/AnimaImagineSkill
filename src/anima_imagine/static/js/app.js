/**
 * AnimaImagine v2 前端主入口。
 *
 * v2 变更：
 * - 启动时加载服务端 UI 配置（分辨率预设单一真相源）
 * - generator 通过事件通知画廊刷新（解除交叉依赖）
 */

import { loadTagData } from './tag-data.js';
import { loadUIConfig } from './utils.js';
import * as galleryView from './gallery-view.js';
import * as generator from './generator.js';
import * as lightbox from './lightbox.js';

// ============================================================
// v2: 先加载服务端 UI 配置（分辨率预设），再初始化各模块
// ============================================================

async function boot() {
  // v2: 加载服务端配置（分辨率预设、默认参数）
  await loadUIConfig();

  // 异步加载标签数据（不阻塞页面）
  loadTagData();

  // 初始化生图面板
  generator.init();

  // 初始化 Lightbox
  lightbox.init({
    onFillGenerator: (img) => generator.fillFromMeta(img),
  });

  // 初始化画廊视图
  galleryView.init({
    onOpenLightbox: (path) => lightbox.open(path, galleryView.getFilteredImages()),
    onFillGenerator: (img) => generator.fillFromMeta(img),
  });

  galleryView.setupGalleryEvents();

  // v2: 监听生成完成事件，刷新画廊（替代 generator 直接 import gallery-view 的交叉依赖）
  generator.onGenerated(() => galleryView.loadData());
}

boot();

// 全局快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    document.getElementById('toggleGenerator')?.click();
  }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    e.preventDefault();
    const panel = document.getElementById('generatorPanel');
    if (panel && panel.style.display === 'none') panel.style.display = 'flex';
    document.getElementById('basicPrompt')?.focus();
  }
});
