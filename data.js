/* Replace this adapter with HTTP calls in 0.2; UI only uses the async API. */
window.KrugData = (() => {
  const B = window.KrugBooking;
  const STORAGE_KEY = 'krug_mini_app_bookings_v1';
  const CLIENT_ID = 'krug-mock-client';
  const tiers = values => values.flatMap((price, i) => price === null ? [] : [{ durationHours: i + 1, totalPrice: price }]);
  const services = [
    { id: 'recording', name: 'Запись', description: 'Твой звук начинается здесь', pricingType: 'hourly', priceTiers: tiers([1200,2400,3300,4250,5200,6150,7100,8050]), active: true },
    { id: 'morning', name: 'Запись утром', description: 'Ранний старт. Начало до 12:00', pricingType: 'hourly', priceTiers: tiers([1000,null,2800,3600,4400,5200,6000,6800]), latestStartHour: 11, active: true },
    { id: 'recording-mix', name: 'Запись + сведение', description: 'От первого дубля до цельного звучания', pricingType: 'hourly', priceTiers: tiers([1800,3600,4800,6000,7200,8400,9600,10800]), active: true },
    { id: 'rental', name: 'Аренда', description: 'Студия для твоей самостоятельной работы', pricingType: 'hourly', priceTiers: tiers([1000,null,2800,3600,4400,5100,5800,6500]), active: true }
  ];
  function readBookings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.some(b => !b || typeof b.id !== 'string' || typeof b.clientId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.startTime) || !Number.isFinite(b.durationHours) || b.durationHours <= 0)) throw new Error();
      return rows;
    } catch {
      throw new Error('Не удалось прочитать сохранённые записи. Проверьте доступ к хранилищу браузера. Данные не перезаписаны.');
    }
  }
  const getServices = async () => structuredClone(services.filter(s => s.active));
  async function getService(id) {
    const service = services.find(s => s.id === id && s.active);
    if (!service) throw new Error('Услуга больше недоступна. Выберите другую.');
    return structuredClone(service);
  }
  async function getAvailability(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < B.today() || date > B.addDays(B.today(), 20)) return { date, closed: true, busy: [] };
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    // One studio, shared busy intervals. Sundays are closed in this mock.
    const busy = day % 2 === 0 ? [{ start: 13 * 60, end: 15 * 60 }] : [{ start: 17 * 60, end: 19 * 60 }];
    for (const booking of readBookings()) {
      if (booking.date === date && booking.status !== 'cancelled') busy.push({ start: B.toMinutes(booking.startTime), end: B.toMinutes(booking.startTime) + booking.durationHours * 60 });
    }
    return { date, open: 9 * 60, close: 23 * 60, closed: day === 0, busy };
  }
  async function getAvailableSlots(date, durationHours, serviceId) {
    let slots = B.availableSlots(await getAvailability(date), durationHours);
    if (serviceId) {
      const service = await getService(serviceId);
      if (service.latestStartHour !== undefined) slots = slots.filter(slot => B.toMinutes(slot) <= service.latestStartHour * 60);
    }
    return slots;
  }
  async function createBooking(data) {
    // Serializes cooperating tabs where Web Locks is available. A real server must
    // enforce uniqueness and interval conflicts transactionally in 0.2.
    const save = async () => {
      const rows = readBookings();
      const existing = rows.find(b => b.requestId === data.requestId && b.clientId === CLIENT_ID);
      if (existing) return structuredClone(existing);
      const service = await getService(data.serviceId);
      const durationHours = B.durationFor(service, data.durationHours);
      const price = B.priceFor(service, durationHours);
      const client = { name: String(data.client?.name || '').trim(), phone: String(data.client?.phone || '').trim(), telegram: String(data.client?.telegram || '').trim() };
      if (client.name.length < 2 || client.name.length > 80 || !/^[+\d\s()\-]{7,30}$/.test(client.phone) || client.phone.replace(/\D/g, '').length < 7 || !/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(client.telegram)) throw new Error('Проверьте имя, телефон и Telegram (например, @your_name).');
      if (!(await getAvailableSlots(data.date, durationHours, service.id)).includes(data.startTime)) throw new Error('Это время уже недоступно. Вернитесь к выбору времени.');
      const booking = { id: crypto.randomUUID(), requestId: data.requestId || crypto.randomUUID(), clientId: CLIENT_ID, serviceId: service.id, serviceName: service.name, durationHours, date: data.date, startTime: data.startTime, price, client, comment: String(data.comment || '').trim().slice(0, 1000), status: 'request', createdAt: new Date().toISOString() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...rows, booking])); }
      catch { throw new Error('Не удалось сохранить запись. Разрешите хранение данных в браузере и попробуйте снова.'); }
      return structuredClone(booking);
    };
    return navigator.locks?.request ? navigator.locks.request('krug-mini-booking', save) : save();
  }
  const getMyBookings = async () => structuredClone(readBookings().filter(b => b.clientId === CLIENT_ID).sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`)));
  return { getServices, getService, getAvailability, getAvailableSlots, createBooking, getMyBookings };
})();
