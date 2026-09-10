// Uses an externally supplied Playwright runtime; no project dependencies.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const output = process.argv[3] || require('node:os').tmpdir();
const base = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(base, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' })[path.extname(file)] || 'text/plain');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const [width, height] of [[390,844],[360,800],[430,932]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      const check = async name => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: overflow on ${name}`);
        await page.screenshot({ path: path.join(output, `krug-mini-${width}-${name}.png`), fullPage: true });
      };
      await page.goto(url);
      await page.getByRole('button', { name: 'Записаться', exact: false }).first().waitFor();
      await check('home');
      await page.locator('[data-action="start"]').click();
      await page.locator('[data-service="recording"]').click();
      await check('service');
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-duration="3"]').click();
      assert.match(await page.locator('.price-panel').innerText(), /3\s300/);
      await check('duration');
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-date]:not([disabled])').first().click();
      const selectedDate = await page.locator('[data-date][aria-pressed="true"]').getAttribute('data-date');
      await check('date');
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-time]').first().click();
      const selectedTime = await page.locator('[data-time][aria-pressed="true"]').getAttribute('data-time');
      await check('time');
      await page.locator('[data-action="next"]').click();
      await page.getByLabel('Имя клиента').fill('Тест Клиент');
      await page.getByLabel('Телефон').fill('+7 999 123-45-67');
      await page.getByLabel('Telegram', { exact: true }).fill('@test_client');
      await page.getByLabel('Комментарий').fill('Тестовая сессия');
      await page.locator('[data-action="back"]').click();
      assert.equal(await page.locator('[data-time][aria-pressed="true"]').getAttribute('data-time'), selectedTime);
      await page.locator('[data-action="next"]').click();
      assert.equal(await page.getByLabel('Имя клиента').inputValue(), 'Тест Клиент');
      await check('confirmation');
      await page.getByRole('button', { name: 'Подтвердить запись' }).click();
      await page.getByRole('heading', { name: 'Запись отправлена' }).waitFor();
      await check('success');
      await page.locator('[data-action="bookings"]').click();
      assert.equal(await page.locator('.booking-card').count(), 1);
      await check('bookings');
      await page.reload();
      await page.locator('[data-action="bookings"]').click();
      assert.equal(await page.locator('.booking-card').count(), 1);
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('krug_mini_app_bookings_v1')));
      assert.equal(persisted[0].date, selectedDate);
      assert.equal(persisted[0].price, 3300);
      // Verify another service cannot occupy this same studio interval.
      assert.equal(await page.evaluate(async ({ date, time }) => (await KrugData.getAvailableSlots(date, 1, 'rental')).includes(time), { date: selectedDate, time: selectedTime }), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}×${height}: 8 screens, back, contacts, submit, reload, shared occupancy, no overflow/errors`);
      await context.close();
    }
    // Fixed service is a test fixture only, not an invented public catalog item.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__telegramCalls = [];
      const record = name => () => window.__telegramCalls.push(name);
      window.Telegram = { WebApp: { ready: record('ready'), expand: record('expand'), close: record('close'), setHeaderColor: record('header'), setBackgroundColor: record('background'), initDataUnsafe: { user: { first_name: 'Тест', username: 'tg_test' } }, BackButton: { onClick: handler => { window.__back = handler; }, show: record('show'), hide: record('hide') }, safeAreaInset: { top: 12, bottom: 15 } } };
    });
    await page.route('**/data.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({ response, body: source + '\nconst originalServices = KrugData.getServices; KrugData.getServices = async () => [...await originalServices(), {id:"fixed-test", name:"Тест fixed", pricingType:"fixed", price:5000, defaultDurationHours:2, active:true}];' });
    });
    await page.goto(url);
    await page.locator('[data-action="start"]').click();
    await page.locator('[data-service="fixed-test"]').click();
    // Exercise UI fixed routing using a mock availability response.
    await page.evaluate(() => { const original = KrugData.getAvailableSlots; KrugData.getAvailableSlots = (date, duration, serviceId) => original(date, duration, serviceId === 'fixed-test' ? undefined : serviceId); });
    await page.locator('[data-action="next"]').click();
    await page.getByRole('heading', { name: 'В какой день?' }).waitFor();
    assert.equal(await page.locator('[data-duration]').count(), 0);
    await page.evaluate(() => window.__back());
    await page.getByRole('heading', { name: 'Что планируешь?' }).waitFor();
    const calls = await page.evaluate(() => { KrugTelegram.closeApp(); return window.__telegramCalls; });
    for (const call of ['ready', 'expand', 'show', 'hide', 'close']) assert.ok(calls.includes(call));
    console.log('PASS fixed duration skip and Telegram adapter stub');
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
