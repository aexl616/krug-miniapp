/* Replace this read-only adapter with the current-client API later. */
window.KrugClient = (() => {
  const fallback = { id: 'krug-mock-client', name: 'Александр', telegram: '@krug_guest', phone: '+7 900 000-00-00' };
  async function getCurrentClient() {
    const bookings = await window.KrugData.getMyBookings();
    const latest = [...bookings].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.client;
    const telegram = window.KrugTelegram.getTelegramUser();
    const completed = bookings.filter(booking => booking.status === 'completed');
    const telegramName = telegram ? [telegram.first_name, telegram.last_name].filter(Boolean).join(' ') : '';
    return {
      ...fallback,
      name: telegramName || latest?.name || fallback.name,
      telegram: telegram ? (telegram.username ? `@${telegram.username}` : '') : (latest ? latest.telegram || '' : fallback.telegram),
      phone: latest?.phone || (telegram ? '' : fallback.phone),
      avatarUrl: null,
      visits: completed.length,
      totalSpent: completed.reduce((total, booking) => total + (Number.isFinite(booking.price) ? booking.price : 0), 0)
    };
  }
  // Telegram data is unverified prefill. It never changes the local client ID.
  return { getCurrentClient };
})();
