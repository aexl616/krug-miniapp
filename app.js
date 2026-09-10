(() => {
  const API = window.KrugData, B = window.KrugBooking, TG = window.KrugTelegram;
  const root = document.getElementById('app');
  const notice = document.getElementById('notice');
  const account = window.KrugAccount;
  const navigation = document.getElementById('main-navigation');
  const DEMO_MODE = window.KrugConfig.DEMO_MODE;
  document.getElementById('demo-indicator').hidden = !DEMO_MODE;
  const syncViewport = () => document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
  syncViewport();
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.addEventListener('resize', syncViewport);
  const money = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
  const hours = value => `${value} ${value === 1 ? 'час' : value < 5 ? 'часа' : 'часов'}`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateLabel = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`));
  let bookingDraft = B.newDraft();
  let services = [], screen = 'home', step = 0, busy = false, renderId = 0, saved = null;
  let dateLimit = 8, flowMessage = '', transitioning = false;
  let fieldErrors = {};
  let bookingsTab = 'upcoming', draftStarted = false;
  const current = () => services.find(s => s.id === bookingDraft.serviceId);
  const steps = () => current()?.isRentalPackage ? ['Формат','Дата','Подтверждение'] : current()?.id === 'rental' ? ['Формат','Длительность','Дата','Время','Подтверждение'] : ['Длительность','Дата','Время','Подтверждение'];
  const button = (label, action, cls = 'primary', disabled = false) => `<button class="${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const heading = (eyebrow, title, hint = '') => `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${hint ? `<p class="muted intro">${hint}</p>` : ''}`;
  function showError(error) { notice.textContent = error.message || 'Не получилось загрузить страницу. Попробуй ещё раз.'; notice.hidden = false; }
  function resetDraft() {
    bookingDraft = B.newDraft();
    draftStarted = true;
    dateLimit = 8; flowMessage = ''; fieldErrors = {};
    const user = TG.getTelegramUser();
    if (user) bookingDraft.client = { name: [user.first_name, user.last_name].filter(Boolean).join(' '), phone: '', telegram: user.username ? `@${user.username}` : '' };
  }
  function selectService(id) {
    const service = services.find(s => s.id === id);
    if (!service) return;
    if (bookingDraft.serviceId !== id) { B.changeService(bookingDraft, service); dateLimit = 8; flowMessage = ''; }
  }
  function footer(label, enabled = true) {
    return `<div class="dock"><div class="dock-summary"><span>${escape(current()?.name || 'Выбери свой звук')}${bookingDraft.durationHours ? ` · ${hours(bookingDraft.durationHours)}` : ''}${pricingHint() ? `<br>${pricingHint()}` : ''}</span><strong>${bookingDraft.price === null ? 'КРУГ' : (current()?.pricingType === 'minimum' ? 'от ' : '') + money(bookingDraft.price)}</strong></div>${button(`${label} <span aria-hidden="true">↗</span>`, 'next', 'primary', !enabled)}</div>`;
  }
  function refreshPrice() {
    if (current() && bookingDraft.durationHours) bookingDraft.price = B.quoteFor(current(), bookingDraft.durationHours, bookingDraft.startTime).totalPrice;
  }
  function pricingHint() {
    const service = current();
    if (service?.pricingType === 'minimum') return 'Предварительная цена от ' + money(service.price) + '. Итог уточняется в студии.';
    if (!service?.morningPricing || !bookingDraft.durationHours) return '';
    if (!bookingDraft.startTime) return 'Цена уточнится после выбора времени';
    const quote = B.quoteFor(service, bookingDraft.durationHours, bookingDraft.startTime);
    return quote.segments.map(segment => `${segment.durationHours} ч × ${money(segment.hourlyRate)}`).join(' + ');
  }
  function priceBreakdown(booking) {
    const snapshot = booking.priceSnapshot || (booking === bookingDraft && current() ? B.quoteFor(current(), booking.durationHours, booking.startTime) : null);
    if (!snapshot?.segments) return '';
    return `<div class="muted">${snapshot.segments.map(segment => `<div>${segment.startTime}–${segment.endTime} · ${segment.durationHours} ч × ${money(segment.hourlyRate)} = ${money(segment.totalPrice)}</div>`).join('')}</div>`;
  }
  function summary(booking, serviceName) {
    return `<div class="summary"><strong>${escape(serviceName || booking.serviceName)}</strong><div class="session-date">${dateLabel(booking.date)}</div><div class="session-time">${booking.startTime}–${B.endTime(booking.startTime, booking.durationHours)} <small>МСК</small></div><p class="muted">${hours(booking.durationHours)}</p>${priceBreakdown(booking)}<div class="summary-total"><span>${(booking.priceSnapshot?.isEstimate || booking === bookingDraft && current()?.pricingType === 'minimum') ? 'Предварительно, от' : 'Итого'}</span><strong>${money(booking.price)}</strong></div></div>`;
  }
  function contactField(name, label, options = '') {
    return `<label for="contact-${name}">${label}</label><input id="contact-${name}" name="${name}" ${options} value="${escape(bookingDraft.client[name])}" aria-invalid="${!!fieldErrors[name]}" aria-describedby="error-${name}"><p class="field-error" id="error-${name}" aria-live="polite">${escape(fieldErrors[name] || '')}</p>`;
  }
  function displayFieldErrors(errors) {
    fieldErrors = errors;
    for (const name of ['name', 'phone', 'telegram']) {
      document.getElementById(`contact-${name}`)?.setAttribute('aria-invalid', String(!!errors[name]));
      const message = document.getElementById(`error-${name}`);
      if (message) message.textContent = errors[name] || '';
    }
  }
  function renderNavigation() {
    const active = screen === 'success' ? 'bookings' : screen === 'other' ? 'home' : screen;
    const items = [['home', 'Главная', '⌂'], ['flow', 'Записаться', '+'], ['bookings', 'Мои записи', '≡'], ['profile', 'Профиль', '○']];
    // Booking starts or resumes from the primary action on Home.
    navigation.innerHTML = items.filter(([id]) => id !== 'flow').map(([id, label, icon]) => `<button type="button" data-action="${id === 'flow' ? 'resume' : id}" ${active === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</button>`).join('');
    navigation.classList.toggle('booking-navigation', screen === 'flow');
    document.title = `КРУГ — ${items.find(([id]) => id === active)?.[1] || 'Запись'}`;
  }
  function bookingCard(booking) {
    const status = Object.hasOwn(account.statuses, booking.status) ? booking.status : 'request';
    return `<article class="booking-card"><span class="status ${status}">${account.statuses[status]}</span><h2>${escape(booking.serviceName)}</h2><p>${dateLabel(booking.date)} · ${booking.startTime}–${B.endTime(booking.startTime, booking.durationHours)}</p><div class="summary-line"><span>${hours(booking.durationHours)}</span><strong>${money(booking.price)}</strong></div></article>`;
  }
  function bonusCount(value) { return new Intl.NumberFormat('ru-RU').format(value); }
  async function renderProfile() {
    const [client, loyalty, history] = await Promise.all([window.KrugClient.getCurrentClient(), window.KrugLoyalty.getLoyaltyBalance(), window.KrugLoyalty.getLoyaltyHistory()]);
    const initials = client.name.split(/\s+/).filter(Boolean).slice(0,2).map(part => [...part][0]).join('');
    return `${heading('ТВОЙ КРУГ', 'Профиль')}<section class="profile-identity"><div class="avatar" aria-label="Аватар-заглушка">${escape(initials)}</div><div><h2>${escape(client.name)}</h2><p class="muted">${escape(client.telegram || 'Telegram — Не указан')}</p></div></section><dl class="profile-contacts"><div><dt>Телефон</dt><dd>${escape(client.phone || 'Не указан')}</dd></div></dl><div class="profile-stats"><div><strong>${client.visits}</strong><span>Посещений</span></div><div><strong>${money(client.totalSpent)}</strong><span>Потрачено всего</span></div></div><p class="muted stats-note">По завершённым записям.</p><section class="loyalty-section" aria-labelledby="loyalty-title"><h2 id="loyalty-title">Бонусы · демо</h2><div class="bonus-total"><strong>${bonusCount(loyalty.balance)}</strong><span>бонусов</span></div><p class="muted">1 бонус = ${loyalty.rublesPerBonus} ₽</p><p class="muted">Демонстрационный баланс и история — пример, не связанный с твоими посещениями.</p><h3>История бонусов</h3><ul class="loyalty-history">${history.map(entry => `<li><div><strong>${escape(entry.title)}</strong><small>${dateLabel(entry.date)}</small></div><span class="${entry.amount > 0 ? 'bonus-positive' : ''}">${entry.amount > 0 ? '+' : '−'}${bonusCount(Math.abs(entry.amount))}</span></li>`).join('')}</ul><p class="muted">Начальный баланс: ${bonusCount(loyalty.openingBalance)} бонусов.</p></section>`;
  }
  async function render() {
    const version = ++renderId;
    refreshPrice();
    notice.hidden = true;
    TG.showBack(screen !== 'home');
    renderNavigation();
    let html = '';
    if (screen === 'other') {
      html = button('← Назад', 'home', 'back') + heading('СТУДИЙНЫЕ УСЛУГИ', 'Прочие услуги', 'Выбери, что будем делать в студии') + '<div class="service-list">' + services.filter(s => s.publicVisible && s.publicCategory === 'other' && ['studio-mixing','studio-beatmaking','studio-mix-master'].includes(s.id)).map(s => `<button class="service-card" data-service-quick="${escape(s.id)}"><span class="service-copy"><strong>${escape(s.publicName)}</strong><small>${s.selectDuration ? 'От 2 часов' : hours(s.defaultDurationHours)}</small><b>${s.pricingType === 'minimum' ? 'от ' : ''}${money(s.price)}</b></span></button>`).join('') + '</div>';
    } else if (screen === 'home') {
      const [bookingResult, loyaltyResult] = await Promise.allSettled([API.getMyBookings(), window.KrugLoyalty.getLoyaltyBalance()]);
      const bookings = bookingResult.status === 'fulfilled' ? bookingResult.value : [];
      const loyalty = loyaltyResult.status === 'fulfilled' ? loyaltyResult.value : null;
      for (const result of [bookingResult, loyaltyResult]) if (result.status === 'rejected') showError(result.reason);
      if (version !== renderId) return;
      const nearest = account.splitBookings(bookings).upcoming[0];
      html = '<section class="home-hero"><p class="eyebrow">СТУДИЯ КРУГ · ГЛАВНАЯ</p><h1>Всё крутится<br>вокруг <span>музыки.</span></h1></section><div class="home-actions">' + (draftStarted ? button('Продолжить запись <span aria-hidden="true">↗</span>', 'start') : '') + '</div>';
      html += '<section class="home-services"><h2>Записаться</h2><div class="quick-grid">' + [['recording','Запись','01'],['recording-mix','Запись + сведение','02'],['rental','Аренда','03'],['other','Прочие услуги','04']].map(([id, name, num]) => '<button class="quick-card" data-service-quick="' + escape(id) + '"><span class="card-index">' + num + '<span>↗</span></span><strong>' + escape(name) + '</strong></button>').join('') + '</div></section>';
      if (nearest) html += '<section class="home-next"><h2>Ближайшая запись</h2>' + bookingCard(nearest) + '</section>';
      html += '<section class="home-bonus" aria-label="Бонусный баланс"><span>Демо-бонусы<strong>' + (loyalty ? bonusCount(loyalty.balance) : '—') + '</strong></span><span>1 бонус = 1 ₽</span></section>';

    } else if (screen === 'flow') {
      const labels = steps(), label = labels[step];
      html = `<nav class="flow-nav" aria-label="Навигация записи">${button('← Назад', 'back', 'back')}<span>${step + 1} / ${labels.length} · ${label}</span></nav><div class="progress" aria-label="Шаг ${step + 1} из ${labels.length}">${labels.map((_, i) => `<span class="${i <= step ? 'filled' : ''}"></span>`).join('')}</div>`;
      if (label === 'Формат') {
        html += heading('АРЕНДА СТУДИИ','Выбери формат аренды') + '<div class="service-list">' + [['rental','Почасовая','Выбрать длительность'],['rental-day','12 часов · День','10:00–22:00 · 9 000 ₽'],['rental-night','12 часов · Ночь','22:00–10:00 следующего дня · 7 500 ₽']].map(([id,name,hint])=>'<button class="service-card" data-rental="'+id+'"><span class="service-copy"><strong>'+name+'</strong><small>'+hint+'</small></span></button>').join('')+'</div>';
      } else if (label === 'Длительность') {
        html += heading('НЕ ТОРОПИ СВОЙ ЗВУК', 'Сколько времени?', escape(current().name));
        html += `<div class="duration-grid">${Array.from({ length: 8 }, (_, i) => i + 1).filter(n => n >= (current().minDurationHours || 1)).map(n => {
          const available = current().selectDuration || current().priceTiers.some(t => t.durationHours === n);
          return `<button class="duration ${bookingDraft.durationHours === n ? 'selected' : ''}" data-duration="${n}" aria-label="${hours(n)}${available ? '' : ' — недоступно'}" aria-pressed="${bookingDraft.durationHours === n}" ${available ? '' : 'disabled'}>${n}<small>${n === 1 ? 'час' : n < 5 ? 'часа' : 'часов'}</small></button>`;
        }).join('')}</div>${current().priceTiers && current().priceTiers.length < 8 ? '<p class="muted">Некоторые варианты длительности недоступны для этой услуги.</p>' : ''}${flowMessage ? `<p class="flow-message" role="status">${escape(flowMessage)}</p>` : ''}<div class="price-panel"><span>${bookingDraft.durationHours ? hours(bookingDraft.durationHours) : 'Выбери длительность'}</span><strong>${bookingDraft.price === null ? '—' : (current()?.pricingType === 'minimum' ? 'от ' : '') + money(bookingDraft.price)}</strong>${bookingDraft.durationHours && current().pricingType === 'hourly' ? `<small>${money(Math.round(bookingDraft.price / bookingDraft.durationHours))} / час</small>` : ''}</div>${footer('Выбрать дату', !!bookingDraft.durationHours)}`;
      } else if (label === 'Дата') {
        html += heading('ВСТРЕТИМСЯ В СТУДИИ', 'В какой день?', 'Ближайшие 3 недели · московское время');
        const dates = Array.from({ length: 21 }, (_, i) => B.addDays(B.today(), i));
        const availability = await Promise.all(dates.map(async date => ({ date, slots: await API.getAvailableSlots(date, bookingDraft.durationHours, bookingDraft.serviceId) })));
        if (version !== renderId) return;
        const availableDates = availability.filter(day => day.slots.length);
        if (bookingDraft.date && !availableDates.some(day => day.date === bookingDraft.date)) {
          bookingDraft.date = null; bookingDraft.startTime = null;
          refreshPrice();
          flowMessage = 'На выбранную длительность нет времени в этот день. Выбери другую дату.';
        }
        const selectedIndex = availableDates.findIndex(day => day.date === bookingDraft.date);
        dateLimit = Math.max(dateLimit, selectedIndex + 1);
        const choices = availableDates.slice(0, dateLimit).map(({ date }) => {
          const i = dates.indexOf(date);
          const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
          return `<button class="date-card ${i < 2 ? 'near-date' : ''} ${bookingDraft.date === date ? 'selected' : ''}" data-date="${date}" aria-pressed="${bookingDraft.date === date}" aria-label="${dateLabel(date)}"><small>${i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : weekday}</small><strong>${Number(date.slice(-2))}</strong><small>${new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(`${date}T12:00:00Z`))}</small></button>`;
        });
        html += `${flowMessage ? `<p class="flow-message" role="status">${escape(flowMessage)}</p>` : ''}<div class="date-grid">${choices.join('')}</div>${availableDates.length > dateLimit ? button('Показать ещё', 'more-dates', 'secondary more-dates') : ''}<p class="muted">${availableDates.length ? 'Только дни, в которых есть время на всю сессию.' : 'В ближайшие 3 недели нет свободного времени на эту длительность. Попробуй выбрать другую.'}</p>${footer(current().isRentalPackage ? 'Проверить запись' : 'Выбрать время', !!bookingDraft.date)}`;
      } else if (label === 'Время') {
        html += heading('ВРЕМЯ ТВОРИТЬ', 'Во сколько?', `${dateLabel(bookingDraft.date)} · ${hours(bookingDraft.durationHours)} · МСК`);
        const slots = await API.getAvailableSlots(bookingDraft.date, bookingDraft.durationHours, bookingDraft.serviceId);
        if (version !== renderId) return;
        if (!slots.includes(bookingDraft.startTime)) bookingDraft.startTime = null;
        refreshPrice();
        html += slots.length ? `<div class="time-grid">${slots.map(time => `<button class="time-card ${bookingDraft.startTime === time ? 'selected' : ''}" data-time="${time}" aria-pressed="${bookingDraft.startTime === time}">${time}</button>`).join('')}</div>${bookingDraft.startTime ? `<p class="chosen-interval" role="status">${bookingDraft.startTime}–${B.endTime(bookingDraft.startTime, bookingDraft.durationHours)}</p>` : ''}<p class="muted">Это время свободно на всю выбранную длительность.</p>` : `<div class="empty"><p>На этот день свободного времени уже нет.</p>${button('Выбрать другую дату', 'back', 'secondary')}</div>`;
        html += footer('Проверить запись', !!bookingDraft.startTime);
      } else {
        html += heading('ПОЧТИ В КРУГЕ', 'Всё верно?');
        html += summary(bookingDraft, current().name);
        const telegramUser = TG.getTelegramUser();
        const telegramName = telegramUser ? [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') : '';
        const telegramContact = telegramUser ? '<div class="telegram-contact"><strong>Свяжемся с тобой в Telegram</strong><span>' + escape(telegramName) + (telegramUser.username ? ' · ' + escape('@' + telegramUser.username) : '') + '</span></div>' : '';
        html += '<form id="booking-form" novalidate><h2>Как с тобой связаться</h2>' + telegramContact;
        html += contactField('name', 'Как тебя зовут?', 'autocomplete="name" maxlength="80" required placeholder="Твоё имя"');
        html += contactField('phone', 'Телефон', 'type="tel" autocomplete="tel" maxlength="40" required placeholder="+7 999 123-45-67"');
        if (!TG.isTelegram()) html += contactField('telegram', 'Telegram · необязательно', 'autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="33" placeholder="@your_name"');
        html += '<p class="muted">' + (telegramUser ? 'Телефон — для связи, если в Telegram не получится.' : 'Укажи телефон, чтобы студия могла связаться с тобой и подтвердить заявку.') + '</p>';
        html += '<label for="comment">Комментарий <span class="muted">· необязательно</span></label><textarea id="comment" name="comment" rows="3" maxlength="1000" placeholder="Расскажи, что будем записывать">' + escape(bookingDraft.comment) + '</textarea></form><div class="dock"><button form="booking-form" type="submit" class="primary" ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Сохраняем…' : 'Отправить заявку <span aria-hidden="true">↗</span>') + '</button></div>';

      }
    } else if (screen === 'success') {
      html = '<div class="success-icon" aria-hidden="true">✓</div>' + heading('ТВОЯ СЛЕДУЮЩАЯ СЕССИЯ', DEMO_MODE ? 'Демо-заявка создана' : 'Заявка отправлена', DEMO_MODE ? '' : 'Студия свяжется с тобой и подтвердит время.') + summary(saved) + '<p class="muted">Заявка доступна в разделе «Мои записи».</p>';
    } else if (screen === 'profile') {
      html = await renderProfile();
    } else {
      const groups = account.splitBookings(await API.getMyBookings());
      if (version !== renderId) return;
      const bookings = groups[bookingsTab];
      html = heading('ТВОЁ ВРЕМЯ В КРУГЕ', 'Мои записи') + '<p class="muted">Время московское</p><div class="booking-tabs" role="tablist" aria-label="Раздел записей">' + [['upcoming','Ближайшие'],['history','История']].map(([id,label]) => '<button role="tab" id="tab-' + id + '" aria-controls="booking-panel" aria-selected="' + (bookingsTab === id) + '" data-action="list-' + id + '">' + label + ' <span>' + groups[id].length + '</span></button>').join('') + '</div><section id="booking-panel" role="tabpanel" aria-labelledby="tab-' + bookingsTab + '">';
      html += bookings.length ? '<div class="booking-list">' + bookings.map(bookingCard).join('') + '</div>' : '<div class="empty"><h2>' + (bookingsTab === 'history' ? 'История пока пуста' : 'Время для новой сессии') + '</h2><p class="muted">' + (bookingsTab === 'history' ? 'Здесь появятся прошедшие и отменённые записи.' : 'Открой главную и нажми «Записаться» — найдём удобное время.') + '</p></div>';
      html += '</section>';
    }

    if (version !== renderId) return;
    const previousScroll = root.querySelector('.screen-content')?.scrollTop || 0;
    root.innerHTML = `<div class="screen-content">${html}</div>`;
    const dock = root.querySelector('.dock');
    if (dock) root.append(dock);
    root.querySelector('.screen-content').scrollTop = previousScroll;
  }
  async function navigate(action) {
    if (busy) return;
    if (action === 'home') screen = 'home';
    if (action === 'other') screen = 'other';
    if (action === 'bookings') screen = 'bookings';
    if (action === 'profile') screen = 'profile';
    if (action === 'start') { if (!draftStarted) { resetDraft(); step = 0; } screen = 'flow'; }
    if (action === 'list-upcoming' || action === 'list-history') bookingsTab = action === 'list-upcoming' ? 'upcoming' : 'history';
    if (action === 'more-dates') dateLimit += 8;
    if (action === 'back') {
      if (screen === 'flow' && step > 0) step--; else screen = current()?.publicCategory === 'other' && screen === 'flow' ? 'other' : 'home';
    }
    if (action === 'next') {
      const label = steps()[step];
      if (label === 'Услуга' && !current() || label === 'Длительность' && !bookingDraft.durationHours || label === 'Дата' && !bookingDraft.date || label === 'Время' && !bookingDraft.startTime) return;
      step = Math.min(step + 1, steps().length - 1);
    }
    await render();
    if (action === 'more-dates') return;
    root.querySelector('.screen-content').scrollTop = 0;
    root.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target || target.disabled || busy || transitioning || target.type === 'submit' && target.form) return;
    transitioning = true;
    try {
      if (target.dataset.action) return await navigate(target.dataset.action);
      if (target.dataset.rental) {
        selectService(target.dataset.rental); bookingDraft.date=null; bookingDraft.startTime=null; step=1;
        await render(); root.querySelector('.screen-content').scrollTop=0; return;
      }
      if (target.dataset.serviceQuick) {
        const id = target.dataset.serviceQuick;
        if (id === 'other') return await navigate('other');
        if (draftStarted && !window.confirm('Начать новую запись? Текущий выбор будет сброшен.')) return;
        resetDraft(); selectService(id); step = 0;
        screen = 'flow';
        await render(); root.querySelector('.screen-content').scrollTop = 0; root.focus({preventScroll:true}); return;
      }
      if (target.dataset.service) selectService(target.dataset.service);
      if (target.dataset.duration) {
        const durationChanged = bookingDraft.durationHours !== Number(target.dataset.duration);
        if (durationChanged) flowMessage = '';
        try {
          const clearedDate = await B.changeDuration(bookingDraft, current(), Number(target.dataset.duration), API.getAvailableSlots);
          if (clearedDate) flowMessage = 'Для новой длительности выбери другую дату.';
        } catch (error) { await render(); throw error; }
        if (durationChanged) dateLimit = 8;
      }
      if (target.dataset.date) { bookingDraft.date = target.dataset.date; bookingDraft.startTime = current()?.fixedStart || null; flowMessage = ''; }
      if (target.dataset.time) bookingDraft.startTime = target.dataset.time;
      const focusKey = ['service', 'duration', 'date', 'time'].find(key => target.dataset[key]);
      await render();
      if (focusKey) root.querySelector(`[data-${focusKey}="${target.dataset[focusKey]}"]`)?.focus({ preventScroll: true });
    } catch (error) { showError(error); }
    finally { transitioning = false; }
  });
  root.addEventListener('input', event => {
    const { name, value } = event.target;
    if (name === 'comment') bookingDraft.comment = value;
    else if (Object.hasOwn(bookingDraft.client, name)) bookingDraft.client[name] = value;
    if (fieldErrors[name]) { delete fieldErrors[name]; displayFieldErrors(fieldErrors); }
  });
  root.addEventListener('submit', async event => {
    if (event.target.id !== 'booking-form') return;
    event.preventDefault();
    if (busy) return;
    notice.hidden = true;
    const errors = B.validateClient(bookingDraft.client);
    displayFieldErrors(errors);
    if (Object.keys(errors).length) { document.getElementById(`contact-${Object.keys(errors)[0]}`)?.focus(); return; }
    busy = true;
    const submit = root.querySelector('[type="submit"]');
    submit.disabled = true; submit.textContent = 'Сохраняем…';
    try {
      saved = await API.createBooking(structuredClone(bookingDraft));
      screen = 'success'; draftStarted = false; await render(); root.querySelector('.screen-content').scrollTop = 0; root.focus();
    } catch (error) {
      if (error.fields) { displayFieldErrors(error.fields); document.getElementById(`contact-${Object.keys(error.fields)[0]}`)?.focus(); }
      else {
        if (error.code === 'SLOT_UNAVAILABLE') { bookingDraft.startTime = null; step = steps().indexOf(current()?.isRentalPackage ? 'Дата' : 'Время'); await render(); root.querySelector('.screen-content').scrollTop = 0; }
        showError(error);
      }
    }
    finally { busy = false; if (submit.isConnected) { submit.disabled = false; submit.textContent = 'Отправить заявку ↗'; } }
  });
  TG.initTelegram(async () => {
    if (busy || transitioning) return;
    transitioning = true;
    try { await navigate('back'); } catch (error) { showError(error); }
    finally { transitioning = false; }
  });
  API.getServices().then(result => { services = [...result, ...result.flatMap(s=>s.packages || [])]; return render(); }).catch(showError);
})();

