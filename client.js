/* Replace this read-only adapter with the current-client API later. */
window.KrugClient = (() => {
  const fallback = { id: 'krug-mock-client', name: 'Демо-профиль', telegram: '', phone: '' };
  const PROFILE_KEY='krug_mini_client_v1';
  function readProfile(){const raw=localStorage.getItem(PROFILE_KEY);return raw ? JSON.parse(raw) : {};}
  async function saveCurrentClient(values){
    const previous=readProfile();const next={...previous,...values};
    const errors=window.KrugBooking.validateClient({name:next.name,phone:next.phone});
    if(Object.keys(errors).length)throw new Error(errors.name || errors.phone);
    next.telegramUserId=window.KrugTelegram.getTelegramUser()?.id || previous.telegramUserId || null;
    next.onboarded=true;localStorage.setItem(PROFILE_KEY,JSON.stringify(next));return getCurrentClient();
  }
  async function getCurrentClient() {
    const profile=readProfile();
    const bookings = await window.KrugData.getMyBookings();
    const latest = [...bookings].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.client;
    const telegram = window.KrugTelegram.getTelegramUser();
    const completed = bookings.filter(booking => booking.status === 'completed');
    const telegramName = telegram ? [telegram.first_name, telegram.last_name].filter(Boolean).join(' ') : '';
    return {
      ...fallback,
      name: profile.name || telegramName || latest?.name || fallback.name,
      telegram: telegram ? (telegram.username ? `@${telegram.username}` : '') : (latest ? latest.telegram || '' : fallback.telegram),
      phone: profile.phone || latest?.phone || (telegram ? '' : fallback.phone),
      onboarded: !!profile.onboarded,
      telegramUserId: telegram?.id || profile.telegramUserId || null,
      avatarUrl: profile.avatarUrl || (typeof telegram?.photo_url === 'string' && /^https:\/\//i.test(telegram.photo_url) ? telegram.photo_url : null),
      visits: completed.length,
      totalSpent: completed.reduce((total, booking) => total + (Number.isFinite(booking.price) ? booking.price : 0), 0)
    };
  }
  // Telegram data is unverified prefill. It never changes the local client ID.
  return { getCurrentClient, saveCurrentClient };
})();
