import { loadUIConfig, showToast } from './utils.js';
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

  // 【v3.1 新增】初始化清理显存按钮
  initUnloadButton();
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

// ------------------------------------------------------------------
// 【v3.1 新增】清理显存按钮逻辑
// ------------------------------------------------------------------

function initUnloadButton() {
  const btn = document.getElementById('unloadModelBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const isReloadMode = btn.textContent.includes('重新加载');

    if (isReloadMode) {
      // --- 重新加载 ---
      btn.disabled = true;
      btn.textContent = '⏳ 正在加载...';

      try {
        const res = await fetch('/api/model/reload', { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
          showToast('✅ 模型已重新加载，可以继续生图', 'success', 4000);
          btn.textContent = '🧹 清理显存';
          btn.title = '卸载模型释放 GPU 显存';
        } else {
          showToast('❌ ' + (data.error || '重载失败'), 'error');
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        if (btn.textContent === '⏳ 正在加载...') {
          btn.textContent = '🧹 清理显存';
        }
      }
      return;
    }

    // --- 卸载 ---
    if (!confirm('确定要卸载模型、释放 GPU 显存吗？\n\n卸载后需要再次点击此按钮重新加载模型。')) {
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 正在清理...';

    try {
      // 先查询当前状态
      const statusRes = await fetch('/api/model/status');
      const status = await statusRes.json();

      if (!status.loaded) {
        showToast('模型未加载，无需清理', 'info');
        btn.textContent = '🧹 清理显存';
        return;
      }

      if (status.queue_size > 0) {
        showToast('队列中有任务在排队，请等待完成后再清理', 'warn');
        btn.textContent = '🧹 清理显存';
        return;
      }

      // 执行卸载
      const res = await fetch('/api/model/unload', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        showToast('✅ 模型已卸载，GPU 显存已释放', 'success', 4000);
        btn.textContent = '🔄 重新加载';
        btn.title = '重新加载模型到 GPU';
      } else {
        showToast('❌ ' + (data.error || '卸载失败'), 'error');
      }
    } catch (err) {
      showToast('❌ 请求失败: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      if (btn.textContent === '⏳ 正在清理...') {
        btn.textContent = '🧹 清理显存';
      }
    }
  });
}
