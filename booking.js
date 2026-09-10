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
    if (!tier) throw new Error('Для этой длительности тариф пока не задан.');
    return tier.totalPrice;
  }
  function durationFor(service, hours) {
    return service.pricingType === 'fixed' ? service.defaultDurationHours : hours;
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
  return { today, addDays, toMinutes, toTime, endTime, priceFor, durationFor, availableSlots, newDraft };
})();
