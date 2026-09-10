window.KrugTelegram = (() => {
  const webApp = () => window.Telegram?.WebApp;
  function expandApp() { webApp()?.expand?.(); }
  function closeApp() { webApp()?.close?.(); }
  function getTelegramUser() { return webApp()?.initDataUnsafe?.user || null; }
  function initTelegram(onBack) {
    const app = webApp();
    if (!app) return;
    app.ready?.();
    expandApp();
    app.setHeaderColor?.('#111111');
    app.setBackgroundColor?.('#111111');
    app.BackButton?.onClick?.(onBack);
    const updateInsets = () => {
      const top = (app.safeAreaInset?.top || 0) + (app.contentSafeAreaInset?.top || 0);
      const bottom = (app.safeAreaInset?.bottom || 0) + (app.contentSafeAreaInset?.bottom || 0);
      document.documentElement.style.setProperty('--tg-inset-top', `${top}px`);
      document.documentElement.style.setProperty('--tg-inset-bottom', `${bottom}px`);
    };
    updateInsets();
    app.onEvent?.('safeAreaChanged', updateInsets);
    app.onEvent?.('contentSafeAreaChanged', updateInsets);
  }
  function showBack(visible) {
    const back = webApp()?.BackButton;
    if (visible) back?.show?.(); else back?.hide?.();
  }
  // Telegram's host may supply the SDK. Browser use has no remote dependency.
  // Unverified Telegram data is used only to prefill fields, never for identity.
  const isTelegram = () => !!webApp();
  return { initTelegram, getTelegramUser, expandApp, closeApp, showBack, isTelegram };
})();
