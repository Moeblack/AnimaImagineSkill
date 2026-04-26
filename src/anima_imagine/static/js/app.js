import { loadUIConfig } from './utils.js';
import * as galleryView from './gallery-view.js';
import * as generator from './generator.js';
import * as lightbox from './lightbox.js';

async function boot() {
  await loadUIConfig();

  await generator.init();

  lightbox.init({
    onFillGenerator: (img) => generator.fillFromMeta(img),
  });

  galleryView.init({
    onOpenLightbox: (path) => lightbox.open(path, galleryView.getFilteredImages()),
    onFillGenerator: (img) => generator.fillFromMeta(img),
  });

  galleryView.setupGalleryEvents();
  generator.onGenerated(() => galleryView.loadData());
}

boot();

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.closest?.('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) {
    return true;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (isEditableTarget(document.activeElement)) return;

  // 改成 Alt+G，避免普通输入或 pill 编辑时误触。
  if ((event.key === 'g' || event.key === 'G') && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('toggleGenerator')?.click();
    return;
  }

  // / 仍然保留为快速聚焦生成面板，但输入态不触发。
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const panel = document.getElementById('generatorPanel');
    if (panel && panel.style.display === 'none') {
      panel.style.display = 'flex';
    }
    document.getElementById('basicPrompt')?.focus();
  }
});
