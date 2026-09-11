(() => {
  const B = window.KrugBooking;
  const API = window.KrugData;
  const Client = window.KrugClient;
  const Loyalty = window.KrugLoyalty;
  const Account = window.KrugAccount;

  if (!B || !API || !Client || !Loyalty || !Account) return;

  Object.assign(Account.statuses, {
    request: 'Ожидает подтверждения',
    in_progress: 'Сессия идёт'
  });

  const rawGetClient = Client.getCurrentClient.bind(Client);
  Client.getCurrentClient = async () => ({ ...(await rawGetClient()), onboarded: true });

  const rawGetServices = API.getServices.bind(API);
  const rawGetService = API.getService.bind(API);
  const rawGetBookings = API.getMyBookings.bind(API);
  const rawCancelBooking = API.cancelBooking.bind(API);
  const rawCreateBooking = API.createBooking.bind(API);

  const mixMasterRate = 3000;
  const recordingRegular = {
    1: 1200,
    2: 2400,
    3: 3300,
    4: 4500,
    5: 5200,
    6: 6400,
    7: 7600,
    8: 8800
  };
  const recordingMorning = {
    1: 1000,
    2: 2000,
    3: 2800,
    4: 3800,
    5: 4400,
    6: 5400,
    7: 6400,
    8: 7400
  };

  const tiersFrom = table => Object.entries(table).map(([durationHours, totalPrice]) => ({
    durationHours: Number(durationHours),
    totalPrice
  }));

  function transformService(service) {
    if (!service) return service;

    if (service.id === 'recording') {
      return {
        ...service,
        priceTiers: tiersFrom(recordingRegular)
      };
    }

    if (service.id === 'studio-mix-master') {
      return {
        ...service,
        pricingType: 'hourly',
        price: null,
        minDurationHours: 2,
        selectDuration: true,
        priceTiers: Array.from({ length: 7 }, (_, i) => {
          const durationHours = i + 2;
          return { durationHours, totalPrice: durationHours * mixMasterRate };
        }),
        publicDescription: 'Сведение и мастеринг в студии · 3 000 ₽/час'
      };
    }

    return service;
  }

  API.getServices = async () => (await rawGetServices()).map(transformService);
  API.getService = async id => transformService(await rawGetService(id));

  const rawQuoteFor = B.quoteFor.bind(B);
  B.quoteFor = (service, hours, startTime) => {
    const durationHours = Number(hours);

    if (service?.id === 'recording') {
      const regularPrice = recordingRegular[durationHours];
      const base = {
        totalPrice: regularPrice,
        pricingPeriod: 'regular',
        regularPrice,
        durationHours,
        startTime: startTime || null,
        endTime: startTime ? B.endTime(startTime, durationHours) : null,
        version: 3
      };
      if (!startTime) return base;

      const start = B.toMinutes(startTime);
      const end = start + durationHours * 60;
      const morningStart = 9 * 60;
      const morningEnd = 15 * 60;
      const boundaries = [...new Set([start, end, morningStart, morningEnd].filter(value => value >= start && value <= end))].sort((a, b) => a - b);
      const segments = boundaries.slice(0, -1).map((from, index) => {
        const to = boundaries[index + 1];
        const segmentHours = (to - from) / 60;
        const isMorning = from >= morningStart && to <= morningEnd;
        const table = isMorning ? recordingMorning : recordingRegular;
        const totalPrice = table[segmentHours] ?? Math.round(segmentHours * (isMorning ? 1000 : 1200));
        return {
          startTime: B.toTime(from),
          endTime: B.toTime(to),
          durationHours: segmentHours,
          hourlyRate: Math.round(totalPrice / segmentHours),
          totalPrice,
          pricingPeriod: isMorning ? 'morning' : 'regular'
        };
      });
      const periods = new Set(segments.map(segment => segment.pricingPeriod));
      return {
        ...base,
        totalPrice: segments.reduce((sum, segment) => sum + segment.totalPrice, 0),
        pricingPeriod: periods.size > 1 ? 'mixed' : segments[0]?.pricingPeriod || 'regular',
        segments
      };
    }

    if (service?.id === 'studio-mix-master') {
      const totalPrice = durationHours * mixMasterRate;
      return {
        totalPrice,
        pricingPeriod: 'regular',
        regularPrice: totalPrice,
        durationHours,
        startTime: startTime || null,
        endTime: startTime ? B.endTime(startTime, durationHours) : null,
        version: 3,
        segments: startTime ? [{
          startTime,
          endTime: B.endTime(startTime, durationHours),
          durationHours,
          hourlyRate: mixMasterRate,
          totalPrice,
          pricingPeriod: 'regular'
        }] : undefined
      };
    }

    return rawQuoteFor(service, hours, startTime);
  };

  const rawChangeDuration = B.changeDuration.bind(B);
  B.changeDuration = async (draft, service, hours, getSlots) => {
    if (service?.id !== 'studio-mix-master') return rawChangeDuration(draft, service, hours, getSlots);
    if (draft.durationHours === hours) return false;
    const previousDate = draft.date;
    Object.assign(draft, {
      durationHours: hours,
      price: hours * mixMasterRate,
      date: null,
      startTime: null
    });
    if (previousDate && (await getSlots(previousDate, hours, service.id)).length) draft.date = previousDate;
    return !!previousDate && !draft.date;
  };

  API.createBooking = async data => {
    const booking = await rawCreateBooking(data);
    if (booking.serviceId !== 'studio-mix-master') return booking;
    const fixed = {
      ...booking,
      price: booking.durationHours * mixMasterRate,
      amountDue: Math.max(0, booking.durationHours * mixMasterRate - (booking.bonusSpent || 0)),
      priceSnapshot: {
        ...(booking.priceSnapshot || {}),
        totalPrice: booking.durationHours * mixMasterRate,
        regularPrice: booking.durationHours * mixMasterRate,
        pricingType: 'hourly',
        isEstimate: false
      }
    };
    try {
      const key = 'krug_mini_app_bookings_v1';
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      const index = rows.findIndex(row => row.id === fixed.id);
      if (index >= 0) {
        rows[index] = fixed;
        localStorage.setItem(key, JSON.stringify(rows));
      }
    } catch {}
    return fixed;
  };

  API.getMyBookings = async () => {
    const bookings = await rawGetBookings();
    const now = Date.now();
    return bookings.map(booking => {
      if (!['request', 'confirmed'].includes(booking.status)) return booking;
      const start = new Date(`${booking.date}T${booking.startTime}:00+03:00`).getTime();
      const end = start + booking.durationHours * 3600000;
      return now >= start && now < end ? { ...booking, status: 'in_progress' } : booking;
    });
  };

  API.cancelBooking = async id => {
    const booking = (await rawGetBookings()).find(item => item.id === id);
    if (booking) {
      const start = new Date(`${booking.date}T${booking.startTime}:00+03:00`).getTime();
      if (Date.now() >= start) {
        throw new Error('После начала сессии отменить запись в приложении нельзя. Свяжись со студией.');
      }
    }
    return rawCancelBooking(id);
  };

  const openingBalance = 700;
  const baseEntries = [
    { id: 'demo-3', amount: -500, title: 'Списание', daysAgo: 3 },
    { id: 'demo-2', amount: 240, title: 'Запись', daysAgo: 7 },
    { id: 'demo-1', amount: 300, title: 'Запись', daysAgo: 14 }
  ];

  async function loyaltyHistory() {
    const history = baseEntries.map(({ daysAgo, ...entry }) => ({
      ...entry,
      date: B.addDays(B.today(), -daysAgo)
    }));

    for (const booking of await rawGetBookings()) {
      if (booking.bonusSpent > 0) {
        const createdDate = (booking.createdAt || booking.date).slice(0, 10);
        if (booking.status === 'cancelled' && booking.cancelledAfterStart === false) {
          history.push({
            id: `${booking.id}-reserve`,
            title: `Резерв · ${booking.serviceName}`,
            amount: -booking.bonusSpent,
            date: createdDate
          });
          history.push({
            id: `${booking.id}-refund`,
            title: 'Возврат за отмену',
            amount: booking.bonusSpent,
            date: booking.cancelledAt.slice(0, 10)
          });
        } else if (booking.status === 'completed' || (booking.status === 'cancelled' && booking.cancelledAfterStart === true)) {
          history.push({
            id: `${booking.id}-spend`,
            title: `Списание · ${booking.serviceName}`,
            amount: -booking.bonusSpent,
            date: createdDate
          });
        } else {
          history.push({
            id: `${booking.id}-reserve`,
            title: `Резерв · ${booking.serviceName}`,
            amount: -booking.bonusSpent,
            date: createdDate
          });
        }
      }

      if (booking.bonusEarned > 0 && booking.paymentStatus === 'paid' && booking.status === 'completed') {
        history.push({
          id: `${booking.id}-earn`,
          title: `Начисление · ${booking.serviceName}`,
          amount: booking.bonusEarned,
          date: booking.paidCompletedAt.slice(0, 10)
        });
      }
    }

    return history.sort((a, b) => b.date.localeCompare(a.date));
  }

  Loyalty.getLoyaltyHistory = loyaltyHistory;
  Loyalty.getLoyaltyBalance = async () => {
    const history = await loyaltyHistory();
    return {
      balance: openingBalance + history.reduce((sum, entry) => sum + entry.amount, 0),
      rublesPerBonus: 1,
      openingBalance
    };
  };
  Loyalty.getRedemptionQuote = async (price, useBonuses) => {
    const { balance } = await Loyalty.getLoyaltyBalance();
    const applied = useBonuses ? Math.min(Math.max(0, price), Math.max(0, balance)) : 0;
    return {
      balance,
      applied,
      payable: Math.max(0, price - applied),
      remaining: balance - applied
    };
  };
})();
