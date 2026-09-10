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
        assert.ok(await page.evaluate(() => {
          const content = document.querySelector('.screen-content')?.getBoundingClientRect();
          const dock = document.querySelector('.dock')?.getBoundingClientRect();
          return !dock || content.bottom <= dock.top + 1 && dock.bottom <= innerHeight;
        }), `${width}: dock covers content on ${name}`);
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
      assert.match(await page.locator('.price-panel').innerText(), /3\s600/);
      await check('duration');
      await page.locator('[data-action="next"]').click();
      assert.ok(await page.locator('[data-date]').count() <= 8);
      await page.locator('[data-date]:not([disabled])').first().click();
      const selectedDate = await page.locator('[data-date][aria-pressed="true"]').getAttribute('data-date');
      await check('date');
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-time]').first().click();
      const selectedTime = await page.locator('[data-time][aria-pressed="true"]').getAttribute('data-time');
      await check('time');
      await page.locator('[data-action="next"]').click();
      await page.getByLabel('Как тебя зовут?').fill('Тест Клиент');
      await page.getByLabel('Телефон').fill('+7 999 123-45-67');
      await page.getByLabel('Telegram · необязательно', { exact: true }).fill('@test_client');
      await page.getByLabel('Комментарий').fill('Тестовая сессия');
      await page.locator('[data-action="back"]').click();
      assert.equal(await page.locator('[data-time][aria-pressed="true"]').getAttribute('data-time'), selectedTime);
      await page.locator('[data-action="next"]').click();
      assert.equal(await page.getByLabel('Как тебя зовут?').inputValue(), 'Тест Клиент');
      await check('confirmation');
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await page.getByRole('heading', { name: 'Демо-заявка создана' }).waitFor();
      await check('success');
      await page.locator('[data-action="bookings"]').click();
      assert.equal(await page.locator('.booking-card').count(), 1);
      await check('bookings');
      await page.reload();
      await page.locator('[data-action="bookings"]').click();
      assert.equal(await page.locator('.booking-card').count(), 1);
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('krug_mini_app_bookings_v1')));
      assert.equal(persisted[0].date, selectedDate);
      assert.equal(persisted[0].price, 3600 - Math.max(0, Math.min(15, Number(selectedTime.slice(0, 2)) + 3) - Math.max(9, Number(selectedTime.slice(0, 2)))) * 200);
      assert.equal(persisted[0].priceSnapshot.totalPrice, persisted[0].price);
      // Verify another service cannot occupy this same studio interval.
      assert.equal(await page.evaluate(async ({ date, time }) => (await KrugData.getAvailableSlots(date, 1, 'rental')).includes(time), { date: selectedDate, time: selectedTime }), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}×${height}: 8 screens, back, contacts, submit, reload, shared occupancy, no overflow/errors`);
      await context.close();
    }
    const priceContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pricePage = await priceContext.newPage();
    await pricePage.goto(url);
    await pricePage.locator('[data-action="start"]').click();
    assert.equal(await pricePage.locator('[data-service="morning"]').count(), 0);
    await pricePage.locator('[data-service="recording"]').click();
    await pricePage.locator('[data-action="next"]').click();
    await pricePage.locator('[data-duration="3"]').click();
    await pricePage.locator('[data-action="next"]').click();
    await pricePage.locator('[data-date]').first().waitFor();
    const pricingDate = await pricePage.evaluate(async () => {
      for (const el of document.querySelectorAll('[data-date]')) {
        const slots = await KrugData.getAvailableSlots(el.dataset.date,3,'recording');
        if (['09:00','12:00','13:00','14:00'].every(time => slots.includes(time))) return el.dataset.date;
      }
    });
    assert.ok(pricingDate);
    await pricePage.locator(`[data-date="${pricingDate}"]`).click();
    await pricePage.locator('[data-action="next"]').click();
    for (const [time, price] of [['09:00',3000],['12:00',3000],['13:00',3200],['14:00',3400]]) {
      await pricePage.locator(`[data-time="${time}"]`).click();
      assert.equal((await pricePage.locator('.dock-summary strong').innerText()).replace(/\D/g,''),String(price));
    }
    await pricePage.locator('[data-time="09:00"]').click();
    await pricePage.locator('[data-action="back"]').click();
    await pricePage.locator(`[data-date="${pricingDate}"]`).click();
    assert.equal((await pricePage.locator('.dock-summary strong').innerText()).replace(/\D/g,''),'3600');
    await pricePage.locator('[data-action="back"]').click();
    await pricePage.locator('[data-duration="4"]').click();
    assert.equal((await pricePage.locator('.dock-summary strong').innerText()).replace(/\D/g,''),'4800');
    await pricePage.locator('[data-action="next"]').click();
    await pricePage.locator('[data-action="next"]').click();
    await pricePage.locator('[data-time="09:00"]').click();
    assert.equal((await pricePage.locator('.dock-summary strong').innerText()).replace(/\D/g,''),'4000');
    await pricePage.screenshot({path:path.join(output,'krug-morning-price.png')});
    await priceContext.close();
    console.log('PASS automatic morning price UI at 09:00/12:00/13:00, date reset and duration change');
    const edgeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const edge = await edgeContext.newPage();
    await edge.goto(url);
    await edge.locator('[data-service-quick="recording"]').click();
    await edge.locator('[data-duration="3"]').click();
    await edge.locator('[data-action="next"]').click();
    await edge.locator('[data-date]').first().waitFor();
    const constrainedDate = await edge.evaluate(async () => {
      for (const button of document.querySelectorAll('[data-date]')) {
        const date = button.dataset.date;
        if (date <= KrugBooking.today()) continue;
        const longSlots = await KrugData.getAvailableSlots(date, 8, 'recording');
        // Reserve one hour inside the sole 8h interval in this isolated context.
        if (longSlots.length) await KrugData.createBooking({ serviceId: 'recording', durationHours: 1, date, startTime: longSlots[0], client: { name: 'Тест занятости', phone: '79991234567' } });
        if (!(await KrugData.getAvailableSlots(date, 8, 'recording')).length && (await KrugData.getAvailableSlots(date, 3, 'recording')).length) return date;
      }
    });
    assert.ok(constrainedDate);
    await edge.locator(`[data-date="${constrainedDate}"]`).click();
    await edge.locator('[data-action="next"]').click();
    await edge.locator('[data-time]').first().click();
    await edge.locator('[data-action="back"]').click();
    await edge.locator('[data-action="back"]').click();
    await edge.locator('[data-duration="1"]').click();
    await edge.locator('[data-action="next"]').click();
    assert.equal(await edge.locator('[data-date][aria-pressed="true"]').getAttribute('data-date'), constrainedDate);
    await edge.locator('[data-action="next"]').click();
    assert.equal(await edge.locator('[data-time][aria-pressed="true"]').count(), 0);
    await edge.locator('[data-action="back"]').click();
    await edge.locator('[data-action="back"]').click();
    await edge.locator('[data-duration="8"]').click();
    assert.match(await edge.locator('.flow-message').innerText(), /Для новой длительности/);
    await edge.locator('[data-action="next"]').click();
    assert.equal(await edge.locator('[data-date][aria-pressed="true"]').count(), 0);
    assert.equal(await edge.locator('[data-date].selected:disabled').count(), 0);
    await edge.locator('[data-action="back"]').click();
    await edge.locator('[data-action="back"]').click();
    await edge.locator('[data-service="rental"]').click();
    await edge.locator('[data-action="next"]').click();
    assert.equal(await edge.locator('[data-duration][aria-pressed="true"]').count(), 0);
    assert.match(await edge.locator('.price-panel').innerText(), /—/);
    await edge.locator('[data-duration="3"]').click();
    await edge.locator('[data-action="next"]').click();
    assert.equal(await edge.locator('[data-date][aria-pressed="true"]').count(), 0);
    const countBefore = await edge.locator('[data-date]').count();
    await edge.locator('[data-action="more-dates"]').click();
    assert.ok(await edge.locator('[data-date]').count() > countBefore);
    await edge.locator('[data-date]').first().click();
    await edge.locator('[data-action="next"]').click();
    assert.equal(await edge.locator('[data-time][aria-pressed="true"]').count(), 0);
    await edge.locator('[data-time]').first().click();
    await edge.locator('[data-action="next"]').click();
    await edge.getByRole('button', { name: 'Отправить заявку' }).click();
    assert.equal(await edge.locator('#contact-name').getAttribute('aria-invalid'), 'true');
    assert.equal(await edge.locator('#contact-phone').getAttribute('aria-invalid'), 'true');
    assert.equal(await edge.locator('#contact-telegram').getAttribute('aria-invalid'), 'false');
    await edge.locator('#contact-name').fill('Анна');
    await edge.locator('#contact-phone').fill('123');
    await edge.getByRole('button', { name: 'Отправить заявку' }).click();
    assert.equal(await edge.locator('#contact-name').inputValue(), 'Анна');
    assert.match(await edge.locator('#error-phone').innerText(), /Введи телефон/);
    await edge.setViewportSize({ width: 360, height: 450 });
    await edge.locator('#contact-phone').fill('8 (999) 123-45-67');
    const submitBox = await edge.getByRole('button', { name: 'Отправить заявку' }).boundingBox();
    assert.ok(submitBox.y + submitBox.height <= 450);
    await edge.screenshot({ path: path.join(output, 'krug-mini-keyboard-height.png') });
    await edge.getByRole('button', { name: 'Отправить заявку' }).click();
    await edge.getByRole('heading', { name: 'Демо-заявка создана' }).waitFor();
    await edge.locator('[data-action="bookings"]').click();
    assert.equal(await edge.locator('.booking-card button').count(), 0);
    await edgeContext.close();
    console.log('PASS back-flow, duration/date revalidation, service reset, date expansion, inline validation, optional Telegram, 450px viewport');
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
    await page.getByRole('heading', { name: 'Выбери услугу' }).waitFor();
    const calls = await page.evaluate(() => { KrugTelegram.closeApp(); return window.__telegramCalls; });
    for (const call of ['ready', 'expand', 'show', 'hide', 'close']) assert.ok(calls.includes(call));
    console.log('PASS fixed duration skip and Telegram adapter stub');
    await context.close();
    for (const username of ['tg_test', undefined]) {
      const tgContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const tgPage = await tgContext.newPage();
      await tgPage.addInitScript(username => { window.Telegram = { WebApp: { initDataUnsafe: { user: { first_name: 'Анна', username } } } }; }, username);
      if (!username) await tgPage.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.KrugConfig = { DEMO_MODE: false };' }));
      await tgPage.goto(url);
      await tgPage.locator('[data-service-quick="recording"]').click();
      await tgPage.locator('[data-duration="1"]').click();
      await tgPage.locator('[data-action="next"]').click();
      await tgPage.locator('[data-date]').first().click();
      await tgPage.locator('[data-action="next"]').click();
      await tgPage.locator('[data-time]').first().click();
      await tgPage.locator('[data-action="next"]').click();
      assert.equal(await tgPage.locator('#contact-telegram').count(), 0);
      assert.match(await tgPage.locator('.telegram-contact').innerText(), /Свяжемся с тобой в Telegram/);
      assert.equal(await tgPage.locator('#contact-name').inputValue(), 'Анна');
      await tgPage.locator('#contact-phone').fill('+7 999 123-45-67');
      await tgPage.getByRole('button', { name: 'Отправить заявку' }).click();
      await tgPage.getByRole('heading', { name: username ? 'Демо-заявка создана' : 'Заявка отправлена' }).waitFor();
      if (!username) assert.equal(await tgPage.locator('#demo-indicator').isVisible(), false);
      await tgContext.close();
    }
    console.log('PASS Telegram with/without username, optional contact submission and production wording flag');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
