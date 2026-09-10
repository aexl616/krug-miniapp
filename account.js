/* Account presentation rules shared by home and the booking list. */
window.KrugAccount = (() => {
  const statuses = { request: 'Заявка отправлена', confirmed: 'Подтверждено', completed: 'Завершено', cancelled: 'Отменено' };
  function splitBookings(bookings, now = new Date()) {
    const upcoming = [], history = [];
    for (const booking of bookings) {
      const end = new Date(`${booking.date}T${booking.startTime}:00+03:00`).getTime() + booking.durationHours * 3600000;
      (booking.status === 'completed' || booking.status === 'cancelled' || end <= now.getTime() ? history : upcoming).push(booking);
    }
    const compare = (a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`);
    upcoming.sort(compare);
    history.sort((a, b) => compare(b, a));
    return { upcoming, history };
  }
  return { statuses, splitBookings };
})();
