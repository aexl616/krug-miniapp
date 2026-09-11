(() => {
  const root = document.getElementById('app');
  const money = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  let draftActive = false;
  let allowNextClick = false;
  let allowConfirmOnce = false;
  let historyLock = false;
  let lastHistoryKey = '';

  window.confirm = () => {
    if (!allowConfirmOnce) return false;
    allowConfirmOnce = false;
    return true;
  };

  const confirmDialog = document.createElement('dialog');
  confirmDialog.className = 'krug-confirm';
  confirmDialog.innerHTML = `
    <form method="dialog" class="krug-confirm-card">
      <p class="krug-confirm-kicker">КРУГ</p>
      <h2 id="krug-confirm-title">Подтвердить действие?</h2>
      <p id="krug-confirm-text" class="muted"></p>
      <div class="krug-confirm-actions">
        <button value="cancel" class="secondary">Оставить как есть</button>
        <button value="confirm" class="primary">Продолжить</button>
      </div>
    </form>`;
  document.body.append(confirmDialog);

  function askConfirm({ title, text, confirmLabel = 'Продолжить' }, onConfirm) {
    confirmDialog.querySelector('#krug-confirm-title').textContent = title;
    confirmDialog.querySelector('#krug-confirm-text').textContent = text;
    confirmDialog.querySelector('[value="confirm"]').textContent = confirmLabel;
    const onClose = () => {
      confirmDialog.removeEventListener('close', onClose);
      if (confirmDialog.returnValue === 'confirm') onConfirm();
    };
    confirmDialog.addEventListener('close', onClose);
    confirmDialog.showModal();
  }

  function currentService() {
    return window.__krugCurrentService || null;
  }

  const rawChangeService = window.KrugBooking?.changeService?.bind(window.KrugBooking);
  if (rawChangeService) {
    window.KrugBooking.changeService = (draft, service) => {
      window.__krugCurrentService = service;
      return rawChangeService(draft, service);
    };
  }

  function enhanceDurationPricing() {
    const service = currentService();
    const grid = root.querySelector('.duration-grid');
    if (!service || !grid || service.pricingType !== 'hourly') return;

    const buttons = [...grid.querySelectorAll('.duration:not(:disabled)')];
    if (!buttons.length) return;

    const rows = buttons.map(button => {
      const hours = Number(button.dataset.duration);
      try {
        const quote = window.KrugBooking.quoteFor(service, hours, null);
        return { button, hours, total: quote.totalPrice, rate: quote.totalPrice / hours };
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (!rows.length) return;
    const baseRate = rows[0].rate;
    const hasSaving = rows.some(row => row.rate < baseRate - 0.5);

    if (hasSaving && !grid.previousElementSibling?.classList?.contains('duration-benefit')) {
      const note = document.createElement('p');
      note.className = 'duration-benefit';
      note.innerHTML = '<span>↘</span><strong>Больше времени — дешевле час</strong>';
      grid.before(note);
    }

    rows.forEach(({ button, rate }) => {
      if (button.querySelector('.duration-rate')) return;
      const rateNode = document.createElement('span');
      rateNode.className = 'duration-rate';
      rateNode.textContent = `${money(Math.round(rate))}/ч`;
      button.append(rateNode);

      const discount = Math.round((1 - rate / baseRate) * 100);
      if (discount > 0) {
        const save = document.createElement('em');
        save.className = 'duration-save';
        save.textContent = `−${discount}%/ч`;
        button.append(save);
      }
    });
  }

  function fixHomePrice() {
    const card = root.querySelector('[data-service-quick="recording"]');
    const price = card?.querySelector('.service-copy b');
    if (price && price.textContent !== 'от 1 000 ₽ / час') price.textContent = 'от 1 000 ₽ / час';
  }

  function cleanProfile() {
    const stats = root.querySelector('.profile-stats');
    if (stats) {
      [...stats.children].forEach(block => {
        if (block.textContent.includes('Потрачено всего')) block.remove();
      });
    }

    const avatar = root.querySelector('.profile-identity .avatar');
    const upload = root.querySelector('.photo-upload');
    if (avatar?.querySelector('img') && upload) {
      const input = upload.querySelector('input');
      const textNode = [...upload.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode) {
        if (textNode.textContent.trim() !== 'Сменить фото') textNode.textContent = 'Сменить фото';
      } else if (input) {
        upload.insertBefore(document.createTextNode('Сменить фото'), input);
      }
    }
  }

  function fixBonusCopy() {
    if (root.dataset.screen !== 'success') return;
    root.querySelectorAll('.muted').forEach(node => {
      if (node.textContent.trim().startsWith('Списано бонусов:')) {
        node.textContent = node.textContent.replace('Списано бонусов:', 'Зарезервировано бонусов:');
      }
    });
  }

  function enhanceHomeProfileShortcut() {
    const homeUser = root.querySelector('.home-user');
    if (!homeUser || homeUser.dataset.profileReady) return;
    homeUser.dataset.profileReady = 'true';
    homeUser.setAttribute('role', 'button');
    homeUser.setAttribute('tabindex', '0');
    homeUser.setAttribute('aria-label', 'Открыть профиль');
  }

  function screenFingerprint() {
    const screen = root.dataset.screen || 'home';
    const step = root.querySelector('.flow-nav > span')?.textContent?.trim() || '';
    return `${screen}|${step}`;
  }

  function syncHistory() {
    if (window.KrugTelegram?.isTelegram?.()) return;
    const key = screenFingerprint();
    if (!lastHistoryKey) {
      history.replaceState({ krug: true, key }, '', location.href);
      lastHistoryKey = key;
      return;
    }
    if (historyLock || key === lastHistoryKey) return;
    history.pushState({ krug: true, key }, '', location.href);
    lastHistoryKey = key;
  }

  function enhance() {
    if (!root) return;
    if (root.querySelector('[data-action="start"]')) draftActive = true;
    if (root.dataset.screen === 'success') draftActive = false;
    fixHomePrice();
    enhanceDurationPricing();
    cleanProfile();
    fixBonusCopy();
    enhanceHomeProfileShortcut();
    syncHistory();
  }

  // Only observe direct screen swaps. Watching the whole subtree caused our own
  // visual enhancements to trigger the observer recursively and starve painting.
  const observer = new MutationObserver(() => queueMicrotask(enhance));
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['data-screen'] });
  enhance();

  document.addEventListener('click', event => {
    const homeUser = event.target.closest('.home-user');
    if (homeUser && !event.target.closest('button')) {
      event.preventDefault();
      document.querySelector('#main-navigation [data-action="profile"]')?.click();
      return;
    }

    const target = event.target.closest('button');
    if (!target) return;

    if (allowNextClick) {
      allowNextClick = false;
      return;
    }

    if (target.dataset.cancel) {
      event.preventDefault();
      event.stopImmediatePropagation();
      askConfirm({
        title: 'Отменить запись?',
        text: 'Запись исчезнет из будущих сессий. Если были использованы бонусы, они вернутся на баланс.',
        confirmLabel: 'Отменить запись'
      }, () => {
        allowNextClick = true;
        allowConfirmOnce = true;
        target.click();
      });
      return;
    }

    if (target.dataset.serviceQuick && target.dataset.serviceQuick !== 'other' && draftActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      askConfirm({
        title: 'Начать новую запись?',
        text: 'Текущий выбор услуги, даты и времени будет сброшен.',
        confirmLabel: 'Начать заново'
      }, () => {
        draftActive = false;
        allowNextClick = true;
        allowConfirmOnce = true;
        target.click();
      });
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (!event.target.closest('.home-user')) return;
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    document.querySelector('#main-navigation [data-action="profile"]')?.click();
  });

  window.addEventListener('popstate', () => {
    if (window.KrugTelegram?.isTelegram?.()) return;
    historyLock = true;
    const back = root.querySelector('.flow-nav [data-action="back"]') || root.querySelector('[data-action="back"]');
    if (back) back.click();
    else if (root.dataset.screen !== 'home') document.querySelector('.brand[data-action="home"]')?.click();
    setTimeout(() => {
      lastHistoryKey = screenFingerprint();
      historyLock = false;
    }, 80);
  });
})();
