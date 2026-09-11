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
  const expected = [[1200,2400,3600,4800,6000,7200,8400,9600],[1000,null,2800,3600,4400,5200,6000,6800],[1800,3600,4800,6000,7200,8400,9600,10800],[1000,null,2800,3600,4400,5100,5800,6500]];
  (await Promise.all(['recording','morning','recording-mix','rental'].map(API.getService))).forEach((service, i) => expected[i].forEach((price, j) => {
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
  assert.equal(row.price, B.quoteFor(await API.getService('recording'), 3, startTime).totalPrice);
  assert.equal(row.status, 'request');
  assert.equal((await API.createBooking(draft)).id, row.id);
  assert.equal((await API.getMyBookings()).length, 1);
  await assert.rejects(API.createBooking({ ...draft, requestId: 'request-two', serviceId: 'rental' }), { code: 'SLOT_UNAVAILABLE' });
  assert.ok(!(await API.getAvailableSlots(date, 1)).includes(startTime));
  const key = 'krug_mini_app_bookings_v1';
  const rows = JSON.parse(storage.get(key));
  storage.set(key, JSON.stringify([...rows, { ...row, id: 'other', clientId: 'other-client' }]));
  assert.equal((await API.getMyBookings()).length, 1);
  storage.set(key, 'broken-json');
  await assert.rejects(API.createBooking({ ...draft, requestId: 'third' }), /не изменены/);
  assert.equal(storage.get(key), 'broken-json');
});
test('morning restriction and storage write failure are explicit', async () => {
  const { B, API, context } = setup();
  let date = B.addDays(B.today(), 1);
  while (!(await API.getAvailableSlots(date, 1, 'recording')).length) date = B.addDays(date, 1);
  const slots = await API.getAvailableSlots(date, 1, 'recording');
  assert.equal((await API.getAvailableSlots(date,1,'morning')).length,0);
  await assert.rejects(API.createBooking({serviceId:'morning'}),/Архивная/);
  context.localStorage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(API.createBooking({ serviceId: 'recording', durationHours: 1, date, startTime: slots[0], client: { name: 'Тест', phone: '79999999999', telegram: '@tester' } }), /Не удалось сохранить/);
});
test('service clears dependencies; duration retains only a still available date', async () => {
  const { B, API } = setup();
  const service = await API.getService('recording');
  const draft = B.newDraft();
  B.changeService(draft, service);
  Object.assign(draft, { durationHours: 3, date: '2030-01-01', startTime: '10:00', price: 3300 });
  assert.equal(await B.changeDuration(draft, service, 4, async () => ['15:00']), false);
  assert.equal(draft.date, '2030-01-01');
  assert.equal(draft.startTime, null);
  assert.equal(draft.price, 4800);
  assert.equal(await B.changeDuration(draft, service, 8, async () => []), true);
  assert.equal(draft.date, null);
  assert.equal(draft.price, 9600);
  draft.date = '2030-01-01'; draft.startTime = '15:00';
  B.changeService(draft, await API.getService('rental'));
  for (const key of ['durationHours','date','startTime','price']) assert.equal(draft[key], null);
  assert.equal(draft.serviceId, 'rental');
  draft.date = '2030-01-01';
  await assert.rejects(B.changeDuration(draft, await API.getService('rental'), 3, async () => { throw new Error('offline'); }));
  assert.equal(draft.date, null);
});
test('optional Telegram, ordinary phone formats and field-specific errors', () => {
  const { B } = setup();
  for (const phone of ['+7 (999) 123-45-67', '8 999 123 45 67', '+1.202.555.0199', '+7 999 123–45–67']) {
    assert.equal(Object.keys(B.validateClient({ name: 'Анна', phone, telegram: '' })).length, 0);
  }
  const errors = B.validateClient({ name: '', phone: 'abc', telegram: 'https://invalid' });
  assert.deepEqual(Object.keys(errors), ['name','phone','telegram']);
});
test('API accepts an application without Telegram and keeps request status', async () => {
  const { B, API } = setup();
  let date = B.addDays(B.today(), 1);
  while (!(await API.getAvailableSlots(date, 1)).length) date = B.addDays(date, 1);
  const row = await API.createBooking({ serviceId: 'recording', durationHours: 1, date, startTime: (await API.getAvailableSlots(date, 1))[0], client: { name: 'Анна', phone: '8 (999) 123-45-67' } });
  assert.equal(row.client.telegram, '');
  assert.equal(row.status, 'request');
});
test('automatic morning pricing uses the complete interval and preserves other prices', async () => {
  const { B, API } = setup();
  const recording = await API.getService('recording');
  assert.ok(!(await API.getServices()).some(s => s.id === 'morning'));
  for (const [start, duration, expected, period] of [
    ['09:00',3,3000,'morning'], ['12:00',3,3000,'morning'],
    ['13:00',3,3200,'mixed'], ['08:00',3,3200,'mixed'],
    ['14:00',3,3400,'mixed'], ['09:00',6,6000,'morning'],
    ['09:00',7,7200,'mixed'], ['09:00',2,2000,'morning']
  ]) {
    const quote = B.quoteFor(recording, duration, start);
    assert.equal(quote.totalPrice, expected, `${start} / ${duration}`);
    assert.equal(quote.pricingPeriod, period);
  }
  assert.equal(B.quoteFor(recording,3,null).totalPrice,3600);
  assert.equal(B.quoteFor(await API.getService('recording-mix'),3,'09:00').totalPrice,4800);
  assert.equal(B.quoteFor(await API.getService('rental'),3,'09:00').totalPrice,2800);
  assert.equal(B.quoteFor({pricingType:'fixed',price:5000},2,'09:00').totalPrice,5000);
});
test('saved morning price snapshot ignores input price and survives retries and catalog mutation', async () => {
  const { B, API, storage } = setup();
  let date = B.addDays(B.today(),1);
  while (!(await API.getAvailableSlots(date,3,'recording')).includes('09:00')) date = B.addDays(date,1);
  const draft = { serviceId:'recording',durationHours:3,date,startTime:'09:00',price:1,priceSnapshot:{totalPrice:1},requestId:'morning-test',client:{name:'Анна',phone:'79991234567'} };
  const saved = await API.createBooking(draft);
  assert.equal(saved.price,3000);
  assert.equal(saved.priceSnapshot.totalPrice,3000);
  assert.equal(saved.priceSnapshot.regularPrice,3600);
  assert.equal(saved.priceSnapshot.pricingPeriod,'morning');
  assert.equal(saved.priceSnapshot.endTime,'12:00');
  const service = await API.getService('recording');
  service.morningPricing.hourlyRate = 1;
  assert.equal((await API.getMyBookings())[0].price,3000);
  assert.equal((await API.createBooking(draft)).id,saved.id);
  assert.equal(JSON.parse(storage.get('krug_mini_app_bookings_v1'))[0].priceSnapshot.totalPrice,3000);
});
test('every duration 1–8 sums morning and ordinary hours, with snapshot segments', async () => {
  const { B, API } = setup();
  const service = await API.getService('recording');
  for (let hours = 1; hours <= 8; hours++) {
    for (let start = 9; start + hours <= 23; start++) {
      const quote = B.quoteFor(service,hours,`${start}:00`);
      let expected = 0;
      for (let hour = start; hour < start + hours; hour++) expected += hour < 15 ? 1000 : 1200;
      assert.equal(quote.totalPrice,expected,`${start}:00 + ${hours}h`);
      assert.equal(quote.segments.reduce((sum,s) => sum + s.durationHours,0),hours);
      assert.equal(quote.segments.reduce((sum,s) => sum + s.totalPrice,0),expected);
    }
  }
  let date = B.addDays(B.today(),1);
  while (!(await API.getAvailableSlots(date,3,'recording')).includes('14:00')) date = B.addDays(date,1);
  const saved = await API.createBooking({serviceId:'recording',durationHours:3,date,startTime:'14:00',price:1,client:{name:'Анна',phone:'79991234567'}});
  assert.equal(saved.price,3400);
  assert.equal(saved.priceSnapshot.pricingPeriod,'mixed');
  assert.deepEqual(Array.from(saved.priceSnapshot.segments,s => s.totalPrice),[1000,2400]);
  assert.equal((await API.getMyBookings())[0].price,3400);
});


test('other services select 2–8 hours without multiplying fixed/minimum prices', async()=>{
 const {API,B}=setup();
 for(const id of ['recording-mix','studio-mixing','studio-beatmaking','studio-mix-master']) {
  const service=await API.getService(id); assert.equal(service.minDurationHours,2);
  await assert.rejects(API.createBooking({serviceId:id,durationHours:1}),/Минимальная/);
  if(id==='recording-mix') continue;
  for(const duration of [2,5,8]) {assert.equal(B.durationFor(service,duration),duration);assert.equal(B.priceFor(service,duration),service.price);}
  let date=B.addDays(B.today(),1);while(!(await API.getAvailableSlots(date,2,id)).length)date=B.addDays(date,1);
  const saved=await API.createBooking({serviceId:id,durationHours:2,date,startTime:(await API.getAvailableSlots(date,2,id))[0],client:{name:'Тест',phone:'79991234567'}});
  assert.equal(saved.price,service.price);assert.equal(saved.durationHours,2);
 }
});
test('rental packages prices, fixed starts, next-day conflicts and occupancy',async()=>{
 const {API,B,storage}=setup();
 const day=await API.getService('rental-day'), night=await API.getService('rental-night');
 assert.equal(B.priceFor(day),9000);assert.equal(B.priceFor(night),7500);
 assert.equal(day.fixedStart,'10:00');assert.equal(night.fixedStart,'22:00');
 assert.equal(B.durationFor(night,1),12);assert.equal(B.endTime('22:00',12),'10:00 следующего дня');
 let date=B.addDays(B.today(),1);while(!(await API.getAvailableSlots(date,12,night.id)).length)date=B.addDays(date,1);
 let occupied=B.addDays(B.today(),1);while(!(await API.getAvailability(occupied)).busy.length)occupied=B.addDays(occupied,1);
 assert.equal((await API.getAvailableSlots(occupied,12,day.id)).length,0);
 const next=B.addDays(date,1);
 const row={id:'conflict',clientId:'krug-mock-client',date:next,startTime:'09:00',durationHours:1,status:'request'};
 storage.set('krug_mini_app_bookings_v1',JSON.stringify([row]));
 assert.equal((await API.getAvailableSlots(date,12,night.id)).length,0);
 row.startTime='10:00';storage.set('krug_mini_app_bookings_v1',JSON.stringify([row]));
 assert.equal((await API.getAvailableSlots(date,12,night.id))[0],'22:00');
 storage.delete('krug_mini_app_bookings_v1');
 const saved=await API.createBooking({serviceId:night.id,durationHours:1,date,startTime:'22:00',price:1,client:{name:'Тест',phone:'79991234567'}});
 assert.equal(saved.price,7500);assert.equal(saved.durationHours,12);
 assert.equal((await API.getAvailableSlots(next,1,'rental')).includes('09:00'),false);
 assert.equal((await API.getAvailableSlots(next,1,'rental')).includes('10:00'),true);
 await assert.rejects(API.createBooking({serviceId:day.id,date,startTime:'11:00'}),/фиксировано/);
});

test('demo horizon has multiple full rental dates while saved conflicts stay enforced',async()=>{
 const {API,B,storage}=setup();let dayDates=[],nightDates=[];
 for(let i=1;i<21;i++){const d=B.addDays(B.today(),i);if((await API.getAvailableSlots(d,12,'rental-day')).length)dayDates.push(d);if((await API.getAvailableSlots(d,12,'rental-night')).length)nightDates.push(d);}
 assert.ok(dayDates.length>=3);assert.ok(nightDates.length>=3);
 const date=dayDates[0];storage.set('krug_mini_app_bookings_v1',JSON.stringify([{id:'busy',clientId:'krug-mock-client',date,startTime:'15:00',durationHours:1,status:'request'}]));
 assert.equal((await API.getAvailableSlots(date,12,'rental-day')).length,0);
 assert.equal((await API.getService('morning')).legacyOnly,true);
});

test('cancellation before start is hidden, after start stays in history and releases occupancy',async()=>{
 const {API,B,storage,context}=setup();vm.runInContext(fs.readFileSync(path.join(__dirname,'..','account.js'),'utf8'),context);
 const make=(id,date)=>({id,clientId:'krug-mock-client',date,startTime:'09:00',durationHours:2,status:'request'});
 storage.set('krug_mini_app_bookings_v1',JSON.stringify([make('future',B.addDays(B.today(),1)),make('past',B.addDays(B.today(),-1))]));
 const future=await API.cancelBooking('future');assert.equal(future.cancelledAfterStart,false);
 const past=await API.cancelBooking('past');assert.equal(past.cancelledAfterStart,true);
 const groups=context.window.KrugAccount.splitBookings(await API.getMyBookings());assert.equal(groups.upcoming.length,0);assert.deepEqual(Array.from(groups.history,b=>b.id),['past']);
 assert.equal((await API.cancelBooking('future')).cancelledAt,future.cancelledAt);
});

test('loyalty redemption, capped remainder, payment accrual, refunds and idempotency',async()=>{
 const {API,B,storage,context}=setup();vm.runInContext(fs.readFileSync(path.join(__dirname,'..','loyalty.js'),'utf8'),context);const L=context.window.KrugLoyalty;
 let date=B.addDays(B.today(),1);while(!(await API.getAvailableSlots(date,1,'recording')).length)date=B.addDays(date,1);
 const draft={serviceId:'recording',durationHours:1,date,startTime:(await API.getAvailableSlots(date,1,'recording'))[0],useBonuses:true,requestId:'redeem',client:{name:'Тест',phone:'79991234567'}};
 const row=await API.createBooking(draft);assert.equal(row.bonusSpent,740);assert.equal(row.amountDue,row.price-740);assert.equal((await L.getLoyaltyBalance()).balance,0);
 assert.equal((await API.createBooking(draft)).id,row.id);assert.equal((await L.getLoyaltyBalance()).balance,0);
 await API.cancelBooking(row.id);assert.equal((await L.getLoyaltyBalance()).balance,740);
 let rows=JSON.parse(storage.get('krug_mini_app_bookings_v1'));rows.push({id:'paid',clientId:'krug-mock-client',serviceName:'Запись',date:B.addDays(B.today(),-1),startTime:'09:00',durationHours:1,price:10000,status:'confirmed',useBonuses:false});storage.set('krug_mini_app_bookings_v1',JSON.stringify(rows));
 await API.completePaidBooking('paid');await API.completePaidBooking('paid');assert.equal((await L.getLoyaltyBalance()).balance,1740);
 const quote=await L.getRedemptionQuote(1000,true);assert.equal(quote.applied,1000);assert.equal(quote.payable,0);assert.equal(quote.remaining,740);
 rows=JSON.parse(storage.get('krug_mini_app_bookings_v1'));rows.push({id:'late',clientId:'krug-mock-client',serviceName:'Запись',date:B.addDays(B.today(),-1),createdAt:B.addDays(B.today(),-2),startTime:'09:00',durationHours:1,price:1200,status:'request',bonusSpent:200,useBonuses:true});storage.set('krug_mini_app_bookings_v1',JSON.stringify(rows));
 await API.cancelBooking('late');assert.equal((await L.getLoyaltyBalance()).balance,1540);
});
