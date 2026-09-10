const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  const storage = new Map();
  const context = vm.createContext({ window: {}, navigator: {}, crypto: require('node:crypto').webcrypto, structuredClone, Intl, Date, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
  for (const file of ['booking.js', 'data.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { B: context.window.KrugBooking, API: context.window.KrugData, storage, context };
}
test('all supplied price tiers are exact; unspecified 2h is unavailable', async () => {
  const { B, API } = setup();
  const expected = [[1200,2400,3300,4250,5200,6150,7100,8050],[1000,null,2800,3600,4400,5200,6000,6800],[1800,3600,4800,6000,7200,8400,9600,10800],[1000,null,2800,3600,4400,5100,5800,6500]];
  (await API.getServices()).forEach((service, i) => expected[i].forEach((price, j) => {
    if (price === null) assert.throws(() => B.priceFor(service, j + 1));
    else assert.equal(B.priceFor(service, j + 1), price);
  }));
  const fixed = { pricingType: 'fixed', price: 5000, defaultDurationHours: 2 };
  assert.equal(B.priceFor(fixed), 5000);
  assert.equal(B.durationFor(fixed, 8), 2);
});
test('5 hours must fit the entire interval, boundaries are half-open', () => {
  const { B } = setup();
  const availability = { date: '2030-01-01', open: 540, close: 1380, busy: [{ start: 780, end: 900 }], closed: false };
  const now = new Date('2029-12-31');
  assert.deepEqual(Array.from(B.availableSlots(availability, 5, now)), ['15:00','16:00','17:00','18:00']);
  const single = B.availableSlots(availability, 1, now);
  assert.ok(single.includes('12:00'));
  assert.ok(single.includes('15:00'));
  assert.ok(!single.includes('13:00'));
  assert.equal(B.availableSlots({ ...availability, closed: true }, 1, now).length, 0);
  assert.equal(B.availableSlots(availability, -1, now).length, 0);
  assert.equal(B.availableSlots(availability, 1, new Date('2030-01-02')).length, 0);
});
test('creation recalculates price, persists, prevents duplicate and overlap, filters client', async () => {
  const { B, API, storage } = setup();
  let date = B.addDays(B.today(), 1);
  while (!(await API.getAvailableSlots(date, 3)).length) date = B.addDays(date, 1);
  const startTime = (await API.getAvailableSlots(date, 3))[0];
  const draft = { serviceId: 'recording', durationHours: 3, date, startTime, price: 1, requestId: 'request-one', client: { name: 'Тест Клиент', phone: '+7 999 123-45-67', telegram: '@test_client' } };
  const row = await API.createBooking(draft);
  assert.equal(row.price, 3300);
  assert.equal(row.status, 'request');
  assert.equal((await API.createBooking(draft)).id, row.id);
  assert.equal((await API.getMyBookings()).length, 1);
  await assert.rejects(API.createBooking({ ...draft, requestId: 'request-two', serviceId: 'rental' }), /недоступно/);
  assert.ok(!(await API.getAvailableSlots(date, 1)).includes(startTime));
  const key = 'krug_mini_app_bookings_v1';
  const rows = JSON.parse(storage.get(key));
  storage.set(key, JSON.stringify([...rows, { ...row, id: 'other', clientId: 'other-client' }]));
  assert.equal((await API.getMyBookings()).length, 1);
  storage.set(key, 'broken-json');
  await assert.rejects(API.createBooking({ ...draft, requestId: 'third' }), /не перезаписаны/);
  assert.equal(storage.get(key), 'broken-json');
});
test('morning restriction and storage write failure are explicit', async () => {
  const { B, API, context } = setup();
  let date = B.addDays(B.today(), 1);
  while (!(await API.getAvailableSlots(date, 1, 'morning')).length) date = B.addDays(date, 1);
  const slots = await API.getAvailableSlots(date, 1, 'morning');
  assert.ok(slots.every(s => Number(s.slice(0, 2)) <= 11));
  context.localStorage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(API.createBooking({ serviceId: 'morning', durationHours: 1, date, startTime: slots[0], client: { name: 'Тест', phone: '79999999999', telegram: '@tester' } }), /Не удалось сохранить/);
});
