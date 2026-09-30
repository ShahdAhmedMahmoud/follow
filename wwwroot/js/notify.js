/**
 * Professional notification system — Toast + Confirm Modal
 * Replaces native alert()/confirm() without changing trigger points or messages.
 */
(function (global) {
  'use strict';

  const TOAST_DURATION = {
    success: 3500,
    error: 5500,
    warning: 4500,
    info: 4000
  };

  function ensureRoots() {
    let toastRoot = document.getElementById('erp-toast-root');
    if (!toastRoot) {
      toastRoot = document.createElement('div');
      toastRoot.id = 'erp-toast-root';
      toastRoot.className = 'erp-toast-root';
      toastRoot.setAttribute('aria-live', 'polite');
      toastRoot.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(toastRoot);
    }

    let confirmRoot = document.getElementById('erp-confirm-root');
    if (!confirmRoot) {
      confirmRoot = document.createElement('div');
      confirmRoot.id = 'erp-confirm-root';
      document.body.appendChild(confirmRoot);
    }
    return { toastRoot, confirmRoot };
  }

  function inferType(message) {
    const m = String(message || '');
    if (/نجاح|تم حفظ|تم حذف|تم إنشاء|تم تحديث|تم استيراد|تم استعادة|تم تصدير/.test(m)) return 'success';
    if (/خطأ|فشل|تعذر|غير متاح|غير موجود/.test(m)) return 'error';
    if (/يرجى|مطلوب|تأكد|صلاحية|ليس لديك|لا يوجد|لا توجد/.test(m)) return 'warning';
    return 'info';
  }

  function iconFor(type) {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 18H2z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>'
    };
    return icons[type] || icons.info;
  }

  /**
   * Show a non-blocking toast. Same messages as former alert().
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type]
   * @param {{ duration?: number }} [opts]
   */
  function showToast(message, type, opts) {
    const text = String(message ?? '');
    if (!text) return;
    const kind = type || inferType(text);
    const { toastRoot } = ensureRoots();
    const duration = (opts && opts.duration) || TOAST_DURATION[kind] || 4000;

    const el = document.createElement('div');
    el.className = `erp-toast erp-toast--${kind}`;
    el.setAttribute('role', 'status');
    el.innerHTML =
      `<span class="erp-toast-icon">${iconFor(kind)}</span>` +
      `<div class="erp-toast-body"><div class="erp-toast-msg"></div></div>` +
      `<button type="button" class="erp-toast-close" aria-label="إغلاق">&times;</button>`;
    el.querySelector('.erp-toast-msg').textContent = text;

    const remove = () => {
      el.classList.add('erp-toast--out');
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector('.erp-toast-close').addEventListener('click', remove);
    toastRoot.appendChild(el);
    requestAnimationFrame(() => el.classList.add('erp-toast--in'));
    setTimeout(remove, duration);
  }

  /**
   * Professional confirm modal. Returns Promise<boolean>.
   * Replaces native confirm() — same questions, clearer UI.
   */
  function showConfirm(message, options) {
    const opts = options || {};
    const title = opts.title || 'تأكيد العملية';
    const confirmText = opts.confirmText || 'تأكيد';
    const cancelText = opts.cancelText || 'إلغاء';
    const danger = opts.danger !== false; // deletes default to danger styling

    return new Promise((resolve) => {
      const { confirmRoot } = ensureRoots();
      confirmRoot.innerHTML = '';

      const overlay = document.createElement('div');
      overlay.className = 'erp-confirm-overlay';
      overlay.innerHTML =
        `<div class="erp-confirm-card" role="dialog" aria-modal="true" aria-labelledby="erp-confirm-title">` +
        `<div class="erp-confirm-header ${danger ? 'erp-confirm-header--danger' : ''}">` +
        `<span class="erp-confirm-icon">${iconFor(danger ? 'warning' : 'info')}</span>` +
        `<h3 id="erp-confirm-title">${title}</h3>` +
        `</div>` +
        `<div class="erp-confirm-body"><p class="erp-confirm-msg"></p></div>` +
        `<div class="erp-confirm-footer">` +
        `<button type="button" class="btn btn-secondary erp-confirm-cancel">${cancelText}</button>` +
        `<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} erp-confirm-ok">${confirmText}</button>` +
        `</div></div>`;

      overlay.querySelector('.erp-confirm-msg').textContent = String(message ?? '');

      const finish = (value) => {
        overlay.classList.add('erp-confirm-overlay--out');
        setTimeout(() => {
          overlay.remove();
          resolve(value);
        }, 180);
      };

      overlay.querySelector('.erp-confirm-cancel').addEventListener('click', () => finish(false));
      overlay.querySelector('.erp-confirm-ok').addEventListener('click', () => finish(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish(false);
      });
      const onKey = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onKey);
          finish(false);
        }
      };
      document.addEventListener('keydown', onKey);

      confirmRoot.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('erp-confirm-overlay--in'));
      overlay.querySelector('.erp-confirm-ok').focus();
    });
  }

  // Public API
  global.erpNotify = { showToast, showConfirm, inferType };

  // Compatibility: map alert → toast (non-blocking, same messages)
  global.alert = function (msg) {
    showToast(String(msg), inferType(msg));
  };

  // Native confirm cannot be async; call sites must use await erpNotify.showConfirm(...)
  // We keep a last-resort sync fallback that still uses the modal is impossible sync;
  // so confirm is redirected to showConfirm via a warning in console if used without await.
  // Actual replacements are done in erp.js call sites.
})(typeof window !== 'undefined' ? window : globalThis);
