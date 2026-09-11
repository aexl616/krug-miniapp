/* Replace this adapter with HTTP calls in 0.2; UI only uses the async API. */
window.KrugData = (() => {
  const B = window.KrugBooking;
  const STORAGE_KEY = 'krug_mini_app_bookings_v1';
  const CLIENT_ID = 'krug-mock-client';
  const tiers = values => values.flatMap((price, i) => price === null ? [] : [{ durationHours: i + 1, totalPrice: price }]);
  const services = [
    { id: 'recording', name: 'Запись', description: 'Запись звука в студии. Запись со сведением — отдельная услуга.', pricingType: 'hourly', priceTiers: tiers([1200,2400,3600,4800,6000,7200,8400,9600]), active: true },
    { id: 'morning', name: 'Запись утром', description: 'Архивная услуга. Только для истории записей.', pricingType: 'hourly', priceTiers: tiers([1000,null,2800,3600,4400,5200,6000,6800]), legacyOnly: true, active: true },
    { id: 'recording-mix', minDurationHours: 2, name: 'Запись + сведение', description: 'Запись звука и сведение в одном формате.', pricingType: 'hourly', priceTiers: tiers([1800,3600,4800,6000,7200,8400,9600,10800]), active: true },
    { id: 'rental', name: 'Аренда', description: 'Студия для твоей самостоятельной работы', pricingType: 'hourly', priceTiers: tiers([1000,null,2800,3600,4400,5100,5800,6500]), active: true }
  ];
  for (const service of services) Object.assign(service, { publicVisible: service.id !== 'morning', publicCategory: 'primary', publicName: service.name, publicDescription: service.description, price: null, duration: null, defaultDuration: null });
  // Values from CRM migrationServiceCatalog; minimum prices remain estimates.
  services.push(...[
    ['studio-mixing', 'Сведение на студии', 4000, 2, 'minimum'],
    ['studio-beatmaking', 'Написание бита на студии', 5000, 1, 'minimum'],
    ['studio-mix-master', 'Сведение + мастер на студии', 3000, null, 'fixed']
  ].map(([id,name,price,duration,pricingType]) => ({id,name,publicName:name,description:'Работа в студии КРУГ.',publicDescription:'Работа в студии КРУГ.',price,pricingType,duration,defaultDuration:duration,defaultDurationHours:duration,active:true,publicVisible:true,publicCategory:'other'})));
  for (const service of services.filter(s => s.publicCategory === 'other')) Object.assign(service, {minDurationHours:2,selectDuration:true,defaultDurationHours:null,defaultDuration:null,duration:null});
  const rentalPackages = [
    {id:'rental-day',name:'Аренда · 12 часов · День',price:9000,fixedStart:'10:00'},
    {id:'rental-night',name:'Аренда · 12 часов · Ночь',price:7500,fixedStart:'22:00'}
  ].map(s=>({...s,pricingType:'fixed',defaultDurationHours:12,active:true,publicVisible:false,isRentalPackage:true}));
  services.push(...rentalPackages);
  services.find(s=>s.id==='rental').packages = rentalPackages;
  // Retain the legacy service for existing records; expose only one recording choice.
  services.find(s => s.id === 'recording').morningPricing = {
    startMinute: 9 * 60, endMinute: 15 * 60,
    hourlyRate: 1000, regularHourlyRate: 1200
  };
  services.find(s => s.id === 'recording').description = 'Каждый час с 09:00 до 15:00 — 1 000 ₽. После 15:00 — 1 200 ₽. Стоимость складывается по времени сессии.';
  function readBookings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.some(b => !b || typeof b.id !== 'string' || typeof b.clientId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.startTime) || !Number.isFinite(b.durationHours) || b.durationHours <= 0)) throw new Error();
      return rows;
    } catch {
      throw new Error('Не удалось открыть твои записи. Попробуй ещё раз. Сохранённые заявки не изменены.');
    }
  }
  const getServices = async () => structuredClone(services.filter(s => s.active && s.publicVisible));
  async function getService(id) {
    const service = services.find(s => s.id === id && s.active);
    if (!service) throw new Error('Эта услуга сейчас недоступна. Выбери другую.');
    return structuredClone(service);
  }
  async function getAvailability(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < B.today() || date > B.addDays(B.today(), 20)) return { date, closed: true, busy: [] };
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    // One studio, shared busy intervals. Sundays are closed in this mock.
    const busy = [1,2,4].includes(day) ? [] : day % 2 === 0 ? [{ start: 13 * 60, end: 15 * 60 }] : [{ start: 17 * 60, end: 19 * 60 }];
    for (const booking of readBookings()) {
      if (booking.status === 'cancelled') continue;
      const offset = (Date.parse(booking.date+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/60000;
      const start = offset+B.toMinutes(booking.startTime), end=start+booking.durationHours*60;
      if (start < 1440 && end > 0) busy.push({start:Math.max(0,start),end:Math.min(1440,end)});
    }
    return { date, open: 9 * 60, close: 23 * 60, closed: day === 0, busy };
  }
  async function getAvailableSlots(date, durationHours, serviceId) {
    const selected = serviceId ? await getService(serviceId) : null;
    if (selected?.legacyOnly) return [];
    if (selected?.isRentalPackage) {
      if (durationHours !== 12 || new Date(date+'T'+selected.fixedStart+':00+03:00') <= new Date()) return [];
      const start=B.toMinutes(selected.fixedStart), end=start+720;
      for (let offset=0; offset<=Math.floor((end-1)/1440); offset++) {
        const day=await getAvailability(B.addDays(date,offset));
        const from=Math.max(0,start-offset*1440), to=Math.min(1440,end-offset*1440);
        if(day.closed || day.busy.some(b=>from<b.end && to>b.start)) return [];
      }
      return [selected.fixedStart];
    }
    if (selected?.minDurationHours && durationHours < selected.minDurationHours) return [];
    let slots = B.availableSlots(await getAvailability(date), durationHours);
    return slots;
  }
  async function createBooking(data) {
    // Serializes cooperating tabs where Web Locks is available. A real server must
    // enforce uniqueness and interval conflicts transactionally in 0.2.
    const save = async () => {
      if ((await getService(data.serviceId)).legacyOnly) throw new Error('Архивная услуга недоступна для новых записей. Выбери «Запись».');
      const rows = readBookings();
      const existing = rows.find(b => b.requestId === data.requestId && b.clientId === CLIENT_ID);
      if (existing) return structuredClone(existing);
      const service = await getService(data.serviceId);
      const durationHours = B.durationFor(service, data.durationHours);
      if (service.isRentalPackage && data.startTime !== service.fixedStart) throw new Error('Время пакета фиксировано.');
      if (service.minDurationHours && durationHours < service.minDurationHours) throw new Error('Минимальная длительность этой услуги — 2 часа.');
      if (!Number.isFinite(durationHours) || durationHours <= 0) throw new Error('Длительность уточняется. Онлайн-запись пока недоступна.');
      const priceSnapshot = { ...B.quoteFor(service, durationHours, data.startTime), serviceId: service.id, date: data.date, pricingType: service.pricingType, isEstimate: service.pricingType === 'minimum' };
      const price = priceSnapshot.totalPrice;
      const client = { name: String(data.client?.name || '').trim(), phone: String(data.client?.phone || '').trim(), telegram: String(data.client?.telegram || '').trim() };
      const fields = B.validateClient(client);
      if (Object.keys(fields).length) throw Object.assign(new Error('Проверь выделенные поля.'), { fields });
      if (!(await getAvailableSlots(data.date, durationHours, service.id)).includes(data.startTime)) throw Object.assign(new Error('Это время уже заняли. Выбери другое время.'), { code: 'SLOT_UNAVAILABLE' });
      const bonusQuote=data.useBonuses ? await window.KrugLoyalty.getRedemptionQuote(price,true) : {applied:0,payable:price};
      const booking = { useBonuses:!!data.useBonuses, bonusSpent:bonusQuote.applied, amountDue:bonusQuote.payable, bonusEarned:0, id: crypto.randomUUID(), requestId: data.requestId || crypto.randomUUID(), clientId: CLIENT_ID, serviceId: service.id, serviceName: service.name, durationHours, date: data.date, startTime: data.startTime, price, priceSnapshot, client, comment: String(data.comment || '').trim().slice(0, 1000), status: 'request', createdAt: new Date().toISOString() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...rows, booking])); }
      catch { throw new Error('Не удалось сохранить заявку на устройстве. Попробуй ещё раз.'); }
      return structuredClone(booking);
    };
    return navigator.locks?.request ? navigator.locks.request('krug-mini-booking', save) : save();
  }
  async function cancelBooking(id) {
    const update=async()=>{
      const rows=readBookings(), row=rows.find(b=>b.id===id && b.clientId===CLIENT_ID);
      if(!row)throw new Error('Запись не найдена.');
      if(row.status==='cancelled')return structuredClone(row);
      if(!['request','confirmed'].includes(row.status))throw new Error('Эту запись уже нельзя отменить.');
      const now=new Date();row.status='cancelled';row.cancelledAt=now.toISOString();
      row.cancelledAfterStart=now.getTime()>=new Date(row.date+'T'+row.startTime+':00+03:00').getTime();
      localStorage.setItem(STORAGE_KEY,JSON.stringify(rows));return structuredClone(row);
    };
    return navigator.locks?.request ? navigator.locks.request('krug-mini-booking',update) : update();
  }
  // Local adapter event for a paid, finished session. No payment UI or real charge.
  async function completePaidBooking(id){
    const update=async()=>{const rows=readBookings(),row=rows.find(b=>b.id===id && b.clientId===CLIENT_ID);
      if(!row)throw new Error('Запись не найдена.');if(row.status==='cancelled')throw new Error('Отменённую запись нельзя завершить.');
      if(row.paidCompletedAt)return structuredClone(row);
      const end=new Date(row.date+'T'+row.startTime+':00+03:00').getTime()+row.durationHours*3600000;if(Date.now()<end)throw new Error('Сессия ещё не завершилась.');
      row.status='completed';row.paymentStatus='paid';row.paidCompletedAt=new Date().toISOString();row.bonusEarned=row.useBonuses?0:Math.floor(row.price*.1);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(rows));return structuredClone(row);};
    return navigator.locks?.request?navigator.locks.request('krug-mini-booking',update):update();
  }
  const getMyBookings = async () => structuredClone(readBookings().filter(b => b.clientId === CLIENT_ID).sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`)));
  return { getServices, getService, getAvailability, getAvailableSlots, createBooking, getMyBookings, cancelBooking, completePaidBooking };
})();
