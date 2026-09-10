/* Read-only demo ledger. No accrual/redemption methods or booking side effects. */
window.KrugLoyalty = (() => {
  const openingBalance = 700;
  const entries = [
    { id: 'demo-3', amount: -500, title: 'Списание', daysAgo: 3 },
    { id: 'demo-2', amount: 240, title: 'Запись', daysAgo: 7 },
    { id: 'demo-1', amount: 300, title: 'Запись', daysAgo: 14 }
  ];
  async function getLoyaltyBalance() { return { balance: openingBalance + entries.reduce((sum, entry) => sum + entry.amount, 0), rublesPerBonus: 1, openingBalance }; }
  async function getLoyaltyHistory() {
    return entries.map(({ daysAgo, ...entry }) => ({ ...entry, date: window.KrugBooking.addDays(window.KrugBooking.today(), -daysAgo) }));
  }
  return { getLoyaltyBalance, getLoyaltyHistory };
})();
