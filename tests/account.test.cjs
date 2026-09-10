const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup(bookings = [], user = null) {
  const window = { KrugData: { getMyBookings: async () => structuredClone(bookings) }, KrugTelegram: { getTelegramUser: () => user } };
  const context = vm.createContext({ window, Date, Intl, crypto: require('node:crypto').webcrypto });
  for (const file of ['booking.js','client.js','loyalty.js','account.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return window;
}
test('fallback profile and completed-only statistics use adapters, not pending applications', async () => {
  const window = setup([
    {status:'completed',price:3400,createdAt:'2030-01-01',client:{name:'Анна',phone:'79991234567',telegram:''}},
    {status:'completed',price:2000,createdAt:'2030-01-01'},
    {status:'request',price:9000,createdAt:'2029-01-01'},
    {status:'cancelled',price:7000,createdAt:'2029-01-01'}
  ]);
  const profile = await window.KrugClient.getCurrentClient();
  assert.equal(profile.name,'Анна');
  assert.equal(profile.phone,'79991234567');
  assert.equal(profile.visits,2);
  assert.equal(profile.totalSpent,5400);
  assert.equal(profile.id,'krug-mock-client');
  const fallback = await setup().KrugClient.getCurrentClient();
  assert.equal(fallback.name,'Александр');
  assert.equal(fallback.visits,0);
  assert.equal(fallback.totalSpent,0);
});
test('Telegram data prefills profile without changing identity or inventing phone', async () => {
  for (const username of ['anna_music',undefined]) {
    const profile = await setup([], {id:987,first_name:'Анна',last_name:'Музыка',username}).KrugClient.getCurrentClient();
    assert.equal(profile.name,'Анна Музыка');
    assert.equal(profile.telegram,username ? '@anna_music' : '');
    assert.equal(profile.phone,'');
    assert.equal(profile.id,'krug-mock-client');
  }
});
test('loyalty ledger reconciles and reads cannot mutate it', async () => {
  const {KrugLoyalty: loyalty} = setup();
  const balance = await loyalty.getLoyaltyBalance();
  const history = await loyalty.getLoyaltyHistory();
  assert.equal(balance.balance,740);
  assert.equal(balance.rublesPerBonus,1);
  assert.equal(history.reduce((sum,entry) => sum + entry.amount,balance.openingBalance),740);
  history[0].amount = 10000; balance.balance = 0;
  assert.equal((await loyalty.getLoyaltyBalance()).balance,740);
  assert.equal((await loyalty.getLoyaltyHistory())[0].amount,-500);
  assert.deepEqual(Object.keys(loyalty).sort(),['getLoyaltyBalance','getLoyaltyHistory']);
});
test('upcoming/history grouping handles ongoing, expired, cancelled, completed and Moscow time', () => {
  const {KrugAccount: account} = setup();
  const bookings = [
    {id:'future',date:'2030-01-02',startTime:'10:00',durationHours:2,status:'confirmed'},
    {id:'cancelled',date:'2030-01-04',startTime:'10:00',durationHours:2,status:'cancelled'},
    {id:'expired',date:'2030-01-01',startTime:'09:00',durationHours:1,status:'request'},
    {id:'ongoing',date:'2030-01-01',startTime:'10:00',durationHours:2,status:'request'},
    {id:'completed',date:'2030-01-03',startTime:'10:00',durationHours:2,status:'completed'}
  ];
  const split = account.splitBookings(bookings,new Date('2030-01-01T07:00:00Z'));
  assert.deepEqual(Array.from(split.upcoming,b => b.id),['ongoing','future']);
  assert.deepEqual(Array.from(split.history,b => b.id),['cancelled','completed','expired']);
  assert.equal(bookings[0].id,'future');
  assert.equal(account.statuses.completed,'Завершено');
});
