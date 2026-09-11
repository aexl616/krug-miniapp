/* Client profile adapter. Local profile remains as UI cache while the CRM backend becomes authoritative. */
window.KrugClient = (() => {
  const fallback = { id: 'krug-mock-client', name: 'Демо-профиль', telegram: '', phone: '' };
  const PROFILE_KEY='krug_mini_client_v1';
  function readProfile(){const raw=localStorage.getItem(PROFILE_KEY);return raw ? JSON.parse(raw) : {};}
  function writeProfile(profile){localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}

  async function registerBackend(profile){
    if (!profile.telegramUserId) return null;
    const base=String(window.KrugConfig?.API_BASE || '').replace(/\/$/,'');
    if(!base)throw new Error('Сервис регистрации временно недоступен.');
    const response=await fetch(`${base}/api/clients/register`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        telegramUserId:profile.telegramUserId,
        name:profile.name,
        phone:profile.phone,
        telegram:profile.telegram || ''
      })
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok || !result.ok)throw new Error(result.message || 'Не удалось сохранить профиль в КРУГ. Попробуй ещё раз.');
    return result.client;
  }

  async function saveCurrentClient(values){
    const previous=readProfile();const next={...previous,...values};
    const errors=window.KrugBooking.validateClient({name:next.name,phone:next.phone});
    if(Object.keys(errors).length)throw new Error(errors.name || errors.phone);
    const telegramUser=window.KrugTelegram.getTelegramUser();
    next.telegramUserId=telegramUser?.id || previous.telegramUserId || null;
    if(telegramUser?.username)next.telegram=`@${telegramUser.username}`;
    next.onboarded=true;
    const remote=await registerBackend(next);
    if(remote){next.backendSynced=true;next.banned=!!remote.banned;}
    writeProfile(next);
    return getCurrentClient();
  }
  async function getCurrentClient() {
    let profile=readProfile();
    const telegram = window.KrugTelegram.getTelegramUser();
    if(profile.onboarded && telegram?.id && !profile.backendSynced && profile.name && profile.phone){
      try{
        const syncProfile={...profile,telegramUserId:telegram.id,telegram:telegram.username?`@${telegram.username}`:(profile.telegram||'')};
        const remote=await registerBackend(syncProfile);
        profile={...syncProfile,backendSynced:true,banned:!!remote?.banned};
        writeProfile(profile);
      }catch{/* Keep the app usable and retry the backfill on a later open. */}
    }
    const bookings = await window.KrugData.getMyBookings();
    const latest = [...bookings].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.client;
    const completed = bookings.filter(booking => booking.status === 'completed');
    const telegramName = telegram ? [telegram.first_name, telegram.last_name].filter(Boolean).join(' ') : '';
    return {
      ...fallback,
      name: profile.name || telegramName || latest?.name || fallback.name,
      telegram: telegram ? (telegram.username ? `@${telegram.username}` : '') : (latest ? latest.telegram || '' : fallback.telegram),
      phone: profile.phone || latest?.phone || (telegram ? '' : fallback.phone),
      onboarded: !!profile.onboarded,
      telegramUserId: telegram?.id || profile.telegramUserId || null,
      banned: !!profile.banned,
      avatarUrl: profile.avatarUrl || (typeof telegram?.photo_url === 'string' && /^https:\/\//i.test(telegram.photo_url) ? telegram.photo_url : null),
      visits: completed.length,
      totalSpent: completed.reduce((total, booking) => total + (Number.isFinite(booking.price) ? booking.price : 0), 0)
    };
  }
  // Telegram data is still unverified during the test phase; server-side initData verification comes with Telegram auth.
  return { getCurrentClient, saveCurrentClient };
})();
