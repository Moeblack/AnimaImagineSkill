import { escapeHtml, showToast } from './utils.js';

let activeContextMenu = null;
let activeContextCleanup = null;

export class PillInput {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.category = opts.category || 'general';
    this.placeholder = opts.placeholder || '';
    this.singleLine = !!opts.singleLine;
    this.onChange = opts.onChange || (() => {});
    this.editingPill = null;

    this._build();
    if (opts.value) this.setValue(opts.value);
  }

  _build() {
    this.root.classList.add('pill-input');
    if (this.singleLine) this.root.classList.add('pill-input-single');
    this.root.dataset.category = this.category;
    this.root.dataset.opsHint = '左拖动 · 中间单击复制 / 双击编辑 · 右删除';

    this.editor = document.createElement('span');
    this.editor.className = 'pill-editor';
    this.editor.contentEditable = 'plaintext-only';
    this.editor.setAttribute('spellcheck', 'false');

    this.placeholderEl = document.createElement('span');
    this.placeholderEl.className = 'pill-placeholder';
    this.placeholderEl.textContent = this.placeholder;

    this.root.appendChild(this.placeholderEl);
    this.root.appendChild(this.editor);

    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root || event.target === this.placeholderEl) {
        event.preventDefault();
        this._focusEditorAtEnd();
      }
    });

    this.editor.addEventListener('keydown', (event) => this._onKeydown(event));
    this.editor.addEventListener('input', () => this._refreshPlaceholder());
    this.editor.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== this.editor) {
          this._commitEditor();
          this._refreshPlaceholder();
        }
      }, 180);
    });

    this._refreshPlaceholder();
  }

  _focusEditorAtEnd() {
    this.editor.focus();
    const range = document.createRange();
    range.selectNodeContents(this.editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  _refreshPlaceholder() {
    const hasPills = this.root.querySelector('.pill') !== null;
    const editorEmpty = !this.editor.textContent.trim();
    this.placeholderEl.style.display = hasPills || !editorEmpty ? 'none' : 'inline';
    this.root.classList.toggle('pill-input-has-pills', hasPills);
  }

  _onKeydown(event) {
    if (event.key === ',' || event.key === '，') {
      event.preventDefault();
      this._commitEditor();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      setTimeout(() => this._commitEditor(), 0);
      return;
    }

    if (event.key === 'Backspace') {
      const selection = window.getSelection();
      const text = this.editor.textContent;
      if (!text && selection.anchorOffset === 0) {
        const pills = this.root.querySelectorAll('.pill');
        if (pills.length) {
          event.preventDefault();
          this._editPill(pills[pills.length - 1]);
        }
      }
    }
  }

  _commitEditor() {
    const raw = this.editor.textContent.trim();
    if (!raw) return;

    const parts = splitTags(raw);
    this.editor.textContent = '';
    parts.forEach((part) => this._insertPillBefore(part, this.editor));
    this._fireChange();
    this._refreshPlaceholder();
  }

  _editPill(pillEl) {
    if (!pillEl || pillEl.classList.contains('editing')) {
      pillEl?.querySelector('.pill-edit-input')?.focus();
      return;
    }

    closeContextMenu();

    if (this.editingPill && this.editingPill !== pillEl) {
      this._finishPillEdit(this.editingPill, { save: true });
    }

    const currentValue = pillEl.dataset.value || '';
    pillEl.classList.add('editing');
    pillEl.setAttribute('draggable', 'false');

    const copyButton = pillEl.querySelector('.pill-copy');
    copyButton.hidden = true;

    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'pill-edit-input';
    editInput.value = currentValue;

    pillEl.insertBefore(editInput, pillEl.querySelector('.pill-remove'));
    this.editingPill = pillEl;

    const commit = () => this._finishPillEdit(pillEl, { save: true });
    const cancel = () => this._finishPillEdit(pillEl, { save: false });

    editInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });

    editInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== editInput) {
          commit();
        }
      }, 100);
    });

    editInput.focus();
    editInput.select();
  }

  _finishPillEdit(pillEl, { save }) {
    if (!pillEl) return;

    const editInput = pillEl.querySelector('.pill-edit-input');
    if (!editInput) return;

    const originalValue = pillEl.dataset.value || '';
    const nextValue = save ? editInput.value.trim() : originalValue;

    editInput.remove();
    pillEl.querySelector('.pill-copy').hidden = false;
    pillEl.classList.remove('editing');
    pillEl.setAttribute('draggable', 'true');

    if (this.editingPill === pillEl) {
      this.editingPill = null;
    }

    if (!nextValue) {
      pillEl.remove();
      this._fireChange();
      this._refreshPlaceholder();
      return;
    }

    if (nextValue !== originalValue) {
      pillEl.dataset.value = nextValue;
      pillEl.dataset.category = detectPillCategory(nextValue, this.category);

      const copyButton = pillEl.querySelector('.pill-copy');
      copyButton.title = getCopyTitle(nextValue);
      pillEl.querySelector('.pill-copy-text').textContent = nextValue;

      this._fireChange();
    }

    this._refreshPlaceholder();
  }

  _removePill(pillEl) {
    closeContextMenu();
    if (this.editingPill === pillEl) {
      this.editingPill = null;
    }
    pillEl.remove();
    this._fireChange();
    this._refreshPlaceholder();
  }

  _insertPillBefore(text, beforeNode) {
    const value = text.trim();
    if (!value) return;

    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.dataset.value = value;
    pill.dataset.category = detectPillCategory(value, this.category);
    pill.setAttribute('draggable', 'true');
    pill.innerHTML = `
      <button type="button" class="pill-drag-handle" title="按住这里拖动排序" aria-label="拖动排序">
        <span class="pill-drag-grip" aria-hidden="true">::</span>
      </button>
      <button type="button" class="pill-copy">
        <span class="pill-copy-text">${escapeHtml(value)}</span>
      </button>
      <button type="button" class="pill-remove" tabindex="-1" title="删除">x</button>
    `;

    const copyButton = pill.querySelector('.pill-copy');
    const removeButton = pill.querySelector('.pill-remove');
    const dragHandle = pill.querySelector('.pill-drag-handle');
    copyButton.title = getCopyTitle(value);

    let clickTimer = 0;
    let suppressCopyClick = false;
    let lastClickAt = 0;

    copyButton.addEventListener('click', async () => {
      if (pill.classList.contains('editing')) return;
      if (suppressCopyClick) {
        suppressCopyClick = false;
        return;
      }

      const now = Date.now();
      if (clickTimer && now - lastClickAt < 260) {
        clearTimeout(clickTimer);
        clickTimer = 0;
        lastClickAt = 0;
        this._editPill(pill);
        return;
      }

      lastClickAt = now;
      clickTimer = window.setTimeout(async () => {
        clickTimer = 0;
        try {
          await navigator.clipboard.writeText(pill.dataset.value || '');
          showToast('已复制标签文本', 'success');
        } catch {
          showToast('复制失败', 'error');
        }
      }, 220);
    });

    wireCopyLongPress(copyButton, pill, this, () => {
      suppressCopyClick = true;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = 0;
      }
    });

    removeButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this._removePill(pill);
    });

    removeButton.addEventListener('touchstart', (event) => {
      event.preventDefault();
      this._removePill(pill);
    }, { passive: false });

    wireDrag(pill, dragHandle, this);
    this.root.insertBefore(pill, beforeNode);
  }

  getValue() {
    if (this.editingPill) {
      this._finishPillEdit(this.editingPill, { save: true });
    }
    this._commitEditor();
    return this.getValueSilent();
  }

  setValue(str) {
    closeContextMenu();
    this.editingPill = null;
    this.root.querySelectorAll('.pill').forEach((pill) => pill.remove());
    this.editor.textContent = '';
    if (str) {
      splitTags(str).forEach((part) => this._insertPillBefore(part, this.editor));
    }
    this._refreshPlaceholder();
    this._fireChange();
  }

  clear() {
    this.setValue('');
  }

  focus() {
    this._focusEditorAtEnd();
  }

  getEditorEl() {
    return this.editor;
  }

  insertTag(tagText) {
    this.editor.textContent = '';
    this._insertPillBefore(tagText, this.editor);
    this._fireChange();
    this._refreshPlaceholder();
    this._focusEditorAtEnd();
  }

  getValueSilent() {
    return Array.from(this.root.querySelectorAll('.pill'))
      .map((pill) => {
        if (pill === this.editingPill) {
          return pill.querySelector('.pill-edit-input')?.value.trim() || '';
        }
        return pill.dataset.value;
      })
      .filter(Boolean)
      .join(', ');
  }

  _fireChange() {
    try {
      this.onChange(this.getValueSilent());
    } catch {
      // Ignore consumer callback failures.
    }
  }
}

function wireDrag(pill, dragHandle, instance) {
  let dragArmed = false;

  dragHandle.addEventListener('mousedown', () => {
    dragArmed = true;
    const clear = () => {
      dragArmed = false;
      document.removeEventListener('mouseup', clear);
    };
    document.addEventListener('mouseup', clear);
  });

  pill.addEventListener('dragstart', (event) => {
    closeContextMenu();
    if (!dragArmed || pill.classList.contains('editing')) {
      event.preventDefault();
      return;
    }
    dragArmed = false;
    pill.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', pill.dataset.value);
  });

  pill.addEventListener('dragend', () => {
    dragArmed = false;
    pill.classList.remove('dragging');
    instance._fireChange();
  });

  pill.addEventListener('dragover', (event) => {
    event.preventDefault();
    const dragging = instance.root.querySelector('.pill.dragging');
    if (!dragging || dragging === pill) return;
    const rect = pill.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    instance.root.insertBefore(dragging, after ? pill.nextSibling : pill);
  });

  let touchState = null;

  dragHandle.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || pill.classList.contains('editing')) return;
    closeContextMenu();

    const touch = event.touches[0];
    touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      dragging: false,
      clone: null,
      timer: window.setTimeout(() => {
        if (!touchState) return;
        touchState.dragging = true;
        pill.classList.add('dragging');
        touchState.clone = createTouchClone(pill, touchState.lastX, touchState.lastY);
        document.body.appendChild(touchState.clone);
      }, 180),
    };
  }, { passive: true });

  dragHandle.addEventListener('touchmove', (event) => {
    if (!touchState) return;

    const touch = event.touches[0];
    touchState.lastX = touch.clientX;
    touchState.lastY = touch.clientY;

    if (!touchState.dragging) {
      const moved = distance(touchState.startX, touchState.startY, touch.clientX, touch.clientY) > 8;
      if (moved) {
        clearTouchDrag(touchState);
        touchState = null;
      }
      return;
    }

    event.preventDefault();
    if (touchState.clone) {
      positionTouchClone(touchState.clone, touch.clientX, touch.clientY);
    }

    const target = findTouchDropTarget(instance.root, pill, touch.clientX, touch.clientY);
    if (!target) return;
    const after = touch.clientX > target.rect.left + target.rect.width / 2;
    instance.root.insertBefore(pill, after ? target.element.nextSibling : target.element);
  }, { passive: false });

  const finishTouchDrag = () => {
    if (!touchState) return;

    if (touchState.dragging) {
      pill.classList.remove('dragging');
      touchState.clone?.remove();
      instance._fireChange();
    }

    clearTouchDrag(touchState);
    touchState = null;
  };

  dragHandle.addEventListener('touchend', finishTouchDrag);
  dragHandle.addEventListener('touchcancel', finishTouchDrag);
}

function wireCopyLongPress(copyButton, pill, instance, onOpenMenu) {
  let touchState = null;

  copyButton.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || pill.classList.contains('editing')) return;
    const touch = event.touches[0];
    touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      timer: window.setTimeout(() => {
        if (!touchState) return;
        onOpenMenu();
        showContextMenu(instance, pill, touchState.startX, touchState.startY);
      }, 320),
    };
  }, { passive: true });

  copyButton.addEventListener('touchmove', (event) => {
    if (!touchState) return;
    const touch = event.touches[0];
    if (distance(touchState.startX, touchState.startY, touch.clientX, touch.clientY) > 10) {
      clearTimeout(touchState.timer);
      touchState = null;
    }
  }, { passive: true });

  const clear = () => {
    if (!touchState) return;
    clearTimeout(touchState.timer);
    touchState = null;
  };

  copyButton.addEventListener('touchend', clear);
  copyButton.addEventListener('touchcancel', clear);
}

function clearTouchDrag(touchState) {
  if (!touchState) return;
  clearTimeout(touchState.timer);
}

function showContextMenu(instance, pill, clientX, clientY) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'pill-context-menu';
  menu.innerHTML = `
    <button type="button" data-act="edit">编辑</button>
    <button type="button" data-act="copy">复制</button>
    <button type="button" data-act="delete" class="danger">删除</button>
  `;
  document.body.appendChild(menu);

  const placeMenu = () => {
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(clientX - rect.width / 2, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(clientY - rect.height - 12, window.innerHeight - rect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };

  requestAnimationFrame(placeMenu);

  menu.addEventListener('click', async (event) => {
    const action = event.target.closest('button')?.dataset.act;
    if (!action) return;

    if (action === 'edit') {
      instance._editPill(pill);
      closeContextMenu();
      return;
    }

    if (action === 'delete') {
      instance._removePill(pill);
      closeContextMenu();
      return;
    }

    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(pill.dataset.value || '');
        showToast('已复制标签文本', 'success');
      } catch {
        showToast('复制失败', 'error');
      }
      closeContextMenu();
    }
  });

  const onPointerDown = (event) => {
    if (!menu.contains(event.target)) {
      closeContextMenu();
    }
  };

  const onViewportChange = () => closeContextMenu();

  window.setTimeout(() => {
    document.addEventListener('pointerdown', onPointerDown);
  }, 0);
  window.addEventListener('resize', onViewportChange, { once: true });
  window.addEventListener('scroll', onViewportChange, { once: true, passive: true });

  activeContextMenu = menu;
  activeContextCleanup = () => {
    document.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange);
  };
}

function closeContextMenu() {
  if (activeContextCleanup) {
    activeContextCleanup();
    activeContextCleanup = null;
  }
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function createTouchClone(pill, clientX, clientY) {
  const clone = pill.cloneNode(true);
  clone.classList.add('pill-touch-clone');
  positionTouchClone(clone, clientX, clientY);
  return clone;
}

function positionTouchClone(clone, clientX, clientY) {
  clone.style.left = `${clientX - 30}px`;
  clone.style.top = `${clientY - 18}px`;
}

function findTouchDropTarget(root, currentPill, clientX, clientY) {
  const pills = root.querySelectorAll('.pill');
  for (const element of pills) {
    if (element === currentPill) continue;
    const rect = element.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return { element, rect };
    }
  }
  return null;
}

function splitTags(value) {
  return value
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function getCopyTitle(value) {
  return `${value}\n单击复制，双击编辑`;
}

function detectPillCategory(text, fieldCategory) {
  const normalized = text.toLowerCase().trim();
  if (normalized.startsWith('@')) return 'artist';
  if (/^score_\d+$/.test(normalized)) return 'score';
  if (/^(masterpiece|best quality|highres|absurdres|good quality|normal quality|low quality|worst quality)$/.test(normalized)) return 'quality';
  if (/^(safe|sensitive|nsfw|explicit)$/.test(normalized)) return 'safety';
  if (/^year \d{4}$|^(newest|recent|mid|early|old)$/.test(normalized)) return 'year';
  if (/^\d*(girl|boy|other)s?$|^no humans$/.test(normalized)) return 'count';
  return fieldCategory || 'general';
}
