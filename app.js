(() => {
  const API = window.KrugData, B = window.KrugBooking, TG = window.KrugTelegram;
  const root = document.getElementById('app');
  const notice = document.getElementById('notice');
  const money = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  const hours = value => `${value} ${value === 1 ? 'час' : value < 5 ? 'часа' : 'часов'}`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateLabel = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`));
  let bookingDraft = B.newDraft();
  let services = [], screen = 'home', step = 0, busy = false, renderId = 0, saved = null;
  const current = () => services.find(s => s.id === bookingDraft.serviceId);
  const steps = () => current()?.pricingType === 'fixed' ? ['Услуга', 'Дата', 'Время', 'Подтверждение'] : ['Услуга', 'Длительность', 'Дата', 'Время', 'Подтверждение'];
  const button = (label, action, cls = 'primary', disabled = false) => `<button class="${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const heading = (eyebrow, title, hint = '') => `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${hint ? `<p class="muted intro">${hint}</p>` : ''}`;
  function showError(error) { notice.textContent = error.message || 'Не удалось загрузить данные. Попробуйте ещё раз.'; notice.hidden = false; }
  function resetDraft() {
    bookingDraft = B.newDraft();
    const user = TG.getTelegramUser();
    if (user) bookingDraft.client = { name: [user.first_name, user.last_name].filter(Boolean).join(' '), phone: '', telegram: user.username ? `@${user.username}` : '' };
  }
  function selectService(id) {
    const service = services.find(s => s.id === id);
    if (!service) return;
    if (bookingDraft.serviceId !== id) {
      bookingDraft.serviceId = id;
      bookingDraft.durationHours = service.pricingType === 'fixed' ? service.defaultDurationHours : null;
      bookingDraft.price = service.pricingType === 'fixed' ? B.priceFor(service) : null;
      bookingDraft.startTime = null;
    }
  }
  function footer(label, enabled = true) {
    return `<div class="dock"><div class="dock-summary"><span>${escape(current()?.name || 'Выбери свой звук')}${bookingDraft.durationHours ? ` · ${hours(bookingDraft.durationHours)}` : ''}</span><strong>${bookingDraft.price === null ? 'КРУГ' : money(bookingDraft.price)}</strong></div>${button(`${label} <span aria-hidden="true">↗</span>`, 'next', 'primary', !enabled)}</div>`;
  }
  function summary(booking, serviceName) {
    return `<div class="summary"><div class="summary-line"><strong>${escape(serviceName || booking.serviceName)}</strong><span>${hours(booking.durationHours)}</span></div><div class="session-date">${dateLabel(booking.date)}</div><div class="session-time">${booking.startTime}–${B.endTime(booking.startTime, booking.durationHours)}</div><div class="summary-total"><span>Итого</span><strong>${money(booking.price)}</strong></div></div>`;
  }
  async function render() {
    const version = ++renderId;
    notice.hidden = true;
    TG.showBack(screen !== 'home');
    let html = '';
    if (screen === 'home') {
      html = `<section class="home-hero"><p class="eyebrow">МЕСТО ДЛЯ ТВОЕГО ЗВУКА</p><h1>Всё крутится<br>вокруг <span>музыки.</span></h1><div class="circle-mark" aria-hidden="true">↗</div></section><div class="home-actions">${button('Записаться <span aria-hidden="true">↗</span>', 'start')}${button('Мои записи', 'bookings', 'secondary')}</div><div class="section-label">НАЙДИ СВОЙ ФОРМАТ <span>01—04</span></div><div class="quick-grid">${[['recording','Запись','01'],['recording-mix','Запись + сведение','02'],['rental','Аренда','03'],['other','Другие услуги','04']].map(([id, name, num]) => `<button class="quick-card" data-service-quick="${id}"><span class="card-index">${num}<span>↗</span></span><strong>${name}</strong></button>`).join('')}</div><p class="demo-note">Демо-запись · заявки сохраняются только на этом устройстве и не отправляются в студию.</p>`;
    } else if (screen === 'flow') {
      const labels = steps(), label = labels[step];
      html = `<nav class="flow-nav" aria-label="Навигация записи">${button('← Назад', 'back', 'back')}<span>${step + 1} / ${labels.length} · ${label}</span></nav><div class="progress" aria-label="Шаг ${step + 1} из ${labels.length}">${labels.map((_, i) => `<span class="${i <= step ? 'filled' : ''}"></span>`).join('')}</div>`;
      if (label === 'Услуга') {
        html += heading('НАЧНЁМ СО ЗВУКА', 'Что планируешь?', 'Выбери формат своей сессии.');
        html += `<div class="service-list">${services.map((s, i) => `<button class="service-card ${bookingDraft.serviceId === s.id ? 'selected' : ''}" data-service="${s.id}" aria-pressed="${bookingDraft.serviceId === s.id}"><span class="service-index">0${i + 1}</span><span class="service-copy"><strong>${escape(s.name)}</strong><small>${escape(s.description)}</small><b>${s.pricingType === 'fixed' ? money(s.price) : `от ${money(s.priceTiers[0].totalPrice)} / час`}</b></span><span class="radio" aria-hidden="true"></span></button>`).join('')}</div>${footer('Дальше', !!current())}`;
      } else if (label === 'Длительность') {
        html += heading('НЕ ТОРОПИ СВОЙ ЗВУК', 'Сколько времени?', escape(current().name));
        html += `<div class="duration-grid">${Array.from({ length: 8 }, (_, i) => i + 1).map(n => {
          const available = current().priceTiers.some(t => t.durationHours === n);
          return `<button class="duration ${bookingDraft.durationHours === n ? 'selected' : ''}" data-duration="${n}" aria-label="${hours(n)}${available ? '' : ' — тариф не задан'}" aria-pressed="${bookingDraft.durationHours === n}" ${available ? '' : 'disabled'}>${n}<small>${n === 1 ? 'час' : n < 5 ? 'часа' : 'часов'}</small></button>`;
        }).join('')}</div>${current().priceTiers.length < 8 ? '<p class="muted">2 часа пока недоступны для этой услуги.</p>' : ''}<div class="price-panel"><span>${bookingDraft.durationHours ? hours(bookingDraft.durationHours) : 'Выбери длительность'}</span><strong>${bookingDraft.price === null ? '—' : money(bookingDraft.price)}</strong>${bookingDraft.durationHours ? `<small>${money(Math.round(bookingDraft.price / bookingDraft.durationHours))} / час</small>` : ''}</div>${footer('Выбрать дату', !!bookingDraft.durationHours)}`;
      } else if (label === 'Дата') {
        html += heading('ВСТРЕТИМСЯ В СТУДИИ', 'В какой день?', 'Ближайшие 3 недели · московское время');
        const dates = Array.from({ length: 21 }, (_, i) => B.addDays(B.today(), i));
        const choices = await Promise.all(dates.map(async (date, i) => {
          const slots = await API.getAvailableSlots(date, bookingDraft.durationHours, bookingDraft.serviceId);
          const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
          return `<button class="date-card ${bookingDraft.date === date ? 'selected' : ''}" data-date="${date}" aria-pressed="${bookingDraft.date === date}" aria-label="${dateLabel(date)}${slots.length ? '' : ', нет времени'}" ${slots.length ? '' : 'disabled'}><small>${i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : weekday}</small><strong>${Number(date.slice(-2))}</strong><small>${new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(`${date}T12:00:00Z`))}</small></button>`;
        }));
        if (version !== renderId) return;
        html += `<div class="date-grid">${choices.join('')}</div><p class="muted">Показываем дни, в которых есть время на всю сессию.</p>${footer('Выбрать время', !!bookingDraft.date && (await API.getAvailableSlots(bookingDraft.date, bookingDraft.durationHours, bookingDraft.serviceId)).length > 0)}`;
      } else if (label === 'Время') {
        html += heading('ВРЕМЯ ТВОРИТЬ', 'Во сколько?', `${dateLabel(bookingDraft.date)} · ${hours(bookingDraft.durationHours)} · МСК`);
        const slots = await API.getAvailableSlots(bookingDraft.date, bookingDraft.durationHours, bookingDraft.serviceId);
        if (version !== renderId) return;
        if (!slots.includes(bookingDraft.startTime)) bookingDraft.startTime = null;
        html += slots.length ? `<div class="time-grid">${slots.map(time => `<button class="time-card ${bookingDraft.startTime === time ? 'selected' : ''}" data-time="${time}" aria-pressed="${bookingDraft.startTime === time}">${time}</button>`).join('')}</div><p class="muted">${bookingDraft.startTime ? `Твоя сессия: ${bookingDraft.startTime}–${B.endTime(bookingDraft.startTime, bookingDraft.durationHours)}.` : 'Каждый слот свободен на всю выбранную длительность.'}</p>` : `<div class="empty"><p>На этот день свободного времени уже нет.</p>${button('Выбрать другую дату', 'back', 'secondary')}</div>`;
        html += footer('Проверить запись', !!bookingDraft.startTime);
      } else {
        html += heading('ПОЧТИ В КРУГЕ', 'Всё верно?');
        html += summary(bookingDraft, current().name);
        html += `<form id="booking-form"><h2>Как с тобой связаться</h2><label>Имя клиента<input name="name" autocomplete="name" minlength="2" maxlength="80" required value="${escape(bookingDraft.client.name)}" placeholder="Как тебя зовут"></label><label>Телефон<input name="phone" type="tel" autocomplete="tel" maxlength="30" required value="${escape(bookingDraft.client.phone)}" placeholder="+7 999 123-45-67"></label><label>Telegram<input name="telegram" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="33" pattern="@?[A-Za-z][A-Za-z0-9_]{4,31}" required value="${escape(bookingDraft.client.telegram)}" placeholder="@your_name"></label><label>Комментарий <span class="muted">· необязательно</span><textarea name="comment" rows="3" maxlength="1000" placeholder="Расскажи, что будем записывать">${escape(bookingDraft.comment)}</textarea></label><p class="demo-note">Это демо. Заявка останется в этом браузере; студия её не получит.</p><div class="dock"><button type="submit" class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Сохраняем…' : 'Подтвердить запись <span aria-hidden="true">↗</span>'}</button></div></form>`;
      }
    } else if (screen === 'success') {
      html = `<div class="success-icon" aria-hidden="true">✓</div>${heading('ТВОЙ СЛЕДУЮЩИЙ ТРЕК', 'Запись отправлена', 'Мы подтвердим запись в Telegram.')}${summary(saved)}<p class="demo-note">Демо-режим: запись сохранена только на устройстве. Сообщение в Telegram не отправляется.</p><div class="stack">${button('Мои записи', 'bookings')}${button('На главную', 'home', 'secondary')}</div>`;
    } else {
      const bookings = await API.getMyBookings();
      if (version !== renderId) return;
      html = `${button('← На главную', 'home', 'back')}${heading('ТВОЁ ВРЕМЯ В КРУГЕ', 'Мои записи')}<p class="muted">Записи на этом устройстве · время МСК</p>`;
      const statuses = { request: 'Заявка', confirmed: 'Подтверждено', cancelled: 'Отменено' };
      html += bookings.length ? `<div class="booking-list">${bookings.map(b => `<article class="booking-card"><span class="status ${['confirmed','cancelled'].includes(b.status) ? b.status : ''}">${statuses[b.status] || 'Заявка'}</span><h2>${escape(b.serviceName)}</h2><p>${dateLabel(b.date)} · ${b.startTime}–${B.endTime(b.startTime, b.durationHours)}</p><div class="summary-line"><span>${hours(b.durationHours)}</span><strong>${money(b.price)}</strong></div><div class="future-actions"><button disabled>Перенести</button><button disabled>Отменить</button></div><small class="muted">Перенос и отмена появятся позже.</small></article>`).join('')}</div>` : `<div class="empty"><span class="empty-symbol" aria-hidden="true">↗</span><h2>Всё начинается с записи</h2><p class="muted">Выбери время для своей первой сессии.</p></div>`;
      html += `<div class="stack">${button('Записаться', 'start')}</div>`;
    }
    if (version !== renderId) return;
    root.innerHTML = html;
  }
  async function navigate(action) {
    if (busy) return;
    if (action === 'home') screen = 'home';
    if (action === 'bookings') screen = 'bookings';
    if (action === 'start') { resetDraft(); screen = 'flow'; step = 0; }
    if (action === 'back') {
      if (screen === 'flow' && step > 0) step--; else screen = 'home';
    }
    if (action === 'next') step = Math.min(step + 1, steps().length - 1);
    await render();
    root.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target || target.disabled || busy || target.type === 'submit' && target.closest('form')) return;
    try {
      if (target.dataset.action) return await navigate(target.dataset.action);
      if (target.dataset.serviceQuick) {
        resetDraft(); screen = 'flow'; step = 0;
        if (target.dataset.serviceQuick !== 'other') { selectService(target.dataset.serviceQuick); step = 1; }
        await render(); root.focus({ preventScroll: true }); window.scrollTo(0, 0); return;
      }
      if (target.dataset.service) selectService(target.dataset.service);
      if (target.dataset.duration) {
        bookingDraft.durationHours = Number(target.dataset.duration);
        bookingDraft.price = B.priceFor(current(), bookingDraft.durationHours);
        bookingDraft.startTime = null;
      }
      if (target.dataset.date) { bookingDraft.date = target.dataset.date; bookingDraft.startTime = null; }
      if (target.dataset.time) bookingDraft.startTime = target.dataset.time;
      const focusKey = ['service', 'duration', 'date', 'time'].find(key => target.dataset[key]);
      await render();
      if (focusKey) root.querySelector(`[data-${focusKey}="${target.dataset[focusKey]}"]`)?.focus({ preventScroll: true });
    } catch (error) { showError(error); }
  });
  root.addEventListener('input', event => {
    const { name, value } = event.target;
    if (name === 'comment') bookingDraft.comment = value;
    else if (Object.hasOwn(bookingDraft.client, name)) bookingDraft.client[name] = value;
  });
  root.addEventListener('submit', async event => {
    if (event.target.id !== 'booking-form') return;
    event.preventDefault();
    if (busy) return;
    busy = true;
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true; submit.textContent = 'Сохраняем…';
    try {
      saved = await API.createBooking(structuredClone(bookingDraft));
      screen = 'success'; await render(); root.focus(); window.scrollTo(0, 0);
    } catch (error) { showError(error); }
    finally { busy = false; if (submit.isConnected) { submit.disabled = false; submit.textContent = 'Подтвердить запись ↗'; } }
  });
  TG.initTelegram(() => navigate('back').catch(showError));
  API.getServices().then(result => { services = result; return render(); }).catch(showError);
})();

