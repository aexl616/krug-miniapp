/* Pure booking rules. No DOM or persistence dependencies. */
window.KrugBooking = (() => {
  const timeZone = 'Europe/Moscow';
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function addDays(date, count) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + count);
    return value.toISOString().slice(0, 10);
  }
  const toMinutes = time => Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
  const toTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const endTime = (start, hours) => toTime(toMinutes(start) + hours * 60);
  function priceFor(service, hours) {
    if (service.pricingType === 'fixed') return service.price;
    const tier = service.priceTiers.find(t => t.durationHours === hours);
    if (!tier) throw new Error('Эта длительность недоступна. Выбери другую.');
    return tier.totalPrice;
  }
  function durationFor(service, hours) {
    return service.pricingType === 'fixed' ? service.defaultDurationHours : hours;
  }
  function quoteFor(service, hours, startTime) {
    const regularPrice = priceFor(service, hours);
    const start = startTime ? toMinutes(startTime) : NaN;
    const rule = service.morningPricing;
    const base = { totalPrice: regularPrice, pricingPeriod: 'regular', regularPrice, durationHours: hours, startTime: startTime || null, endTime: startTime ? endTime(startTime, hours) : null, version: 2 };
    if (!rule || !Number.isFinite(start)) return base;
    const end = start + hours * 60;
    const boundaries = [...new Set([start, end, rule.startMinute, rule.endMinute].filter(value => value >= start && value <= end))].sort((a, b) => a - b);
    const segments = boundaries.slice(0, -1).map((from, i) => {
      const to = boundaries[i + 1];
      const period = from >= rule.startMinute && to <= rule.endMinute ? 'morning' : 'regular';
      const hourlyRate = period === 'morning' ? rule.hourlyRate : rule.regularHourlyRate;
      const durationHours = (to - from) / 60;
      return { startTime: toTime(from), endTime: toTime(to), durationHours, hourlyRate, totalPrice: Math.round(durationHours * hourlyRate), pricingPeriod: period };
    });
    const periods = new Set(segments.map(segment => segment.pricingPeriod));
    return { ...base, totalPrice: segments.reduce((sum, segment) => sum + segment.totalPrice, 0), pricingPeriod: periods.size > 1 ? 'mixed' : segments[0].pricingPeriod, segments };
  }
  function availableSlots(availability, durationHours, now = new Date()) {
    if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 8 || availability.closed) return [];
    const slots = [];
    for (let start = availability.open; start + durationHours * 60 <= availability.close; start += 60) {
      const end = start + durationHours * 60;
      if (new Date(`${availability.date}T${toTime(start)}:00+03:00`) <= now) continue;
      if (availability.busy.some(interval => start < interval.end && end > interval.start)) continue;
      slots.push(toTime(start));
    }
    return slots;
  }
  function newDraft() {
    return { serviceId: null, durationHours: null, date: null, startTime: null, price: null, client: { name: '', phone: '', telegram: '' }, comment: '', requestId: crypto.randomUUID() };
  }
  function validateClient(client = {}) {
    const errors = {};
    const name = String(client.name || '').trim();
    const phone = String(client.phone || '').trim();
    const telegram = String(client.telegram || '').trim();
    if (name.length < 2 || name.length > 80) errors.name = 'Напиши своё имя — от 2 до 80 символов.';
    const digits = phone.replace(/\D/g, '');
    if (!/^[+\d\s().\-–—]+$/.test(phone) || digits.length < 7 || digits.length > 15) errors.phone = 'Введи телефон с кодом страны, например +7 999 123-45-67.';
    if (telegram && !/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegram)) errors.telegram = 'Проверь имя в Telegram, например @your_name, или оставь поле пустым.';
    return errors;
  }
  function changeService(draft, service) {
    if (draft.serviceId === service.id) return;
    Object.assign(draft, { serviceId: service.id, durationHours: service.pricingType === 'fixed' ? service.defaultDurationHours : null, date: null, startTime: null, price: service.pricingType === 'fixed' ? priceFor(service) : null });
  }
  async function changeDuration(draft, service, hours, getSlots) {
    if (draft.durationHours === hours) return false;
    const price = priceFor(service, hours);
    // Clear the old date first so a failed availability request cannot keep it selected.
    const previousDate = draft.date;
    Object.assign(draft, { durationHours: hours, price, date: null, startTime: null });
    if (previousDate && (await getSlots(previousDate, hours, service.id)).length) draft.date = previousDate;
    return !!previousDate && !draft.date;
  }
  return { today, addDays, toMinutes, toTime, endTime, priceFor, quoteFor, durationFor, availableSlots, newDraft, validateClient, changeService, changeDuration };
})();
