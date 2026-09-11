/* Demo ledger projection: opening entries plus atomic booking snapshots. */
window.KrugLoyalty = (() => {
  const openingBalance = 700;
  const entries = [
    { id: 'demo-3', amount: -500, title: 'Списание', daysAgo: 3 },
    { id: 'demo-2', amount: 240, title: 'Запись', daysAgo: 7 },
    { id: 'demo-1', amount: 300, title: 'Запись', daysAgo: 14 }
  ];
  async function getLoyaltyBalance() {const history=await getLoyaltyHistory();return {balance:openingBalance+history.reduce((sum,e)=>sum+e.amount,0),rublesPerBonus:1,openingBalance};}
  async function getLoyaltyHistory() {
    const history=entries.map(({daysAgo,...entry})=>({...entry,date:window.KrugBooking.addDays(window.KrugBooking.today(),-daysAgo)}));
    for(const b of await window.KrugData.getMyBookings()){
      if(b.bonusSpent>0){history.push({id:b.id+'-spend',title:'Списание · '+b.serviceName,amount:-b.bonusSpent,date:(b.createdAt || b.date).slice(0,10)});
        if(b.status==='cancelled' && b.cancelledAfterStart===false)history.push({id:b.id+'-refund',title:'Возврат за отмену',amount:b.bonusSpent,date:b.cancelledAt.slice(0,10)});
      }
      if(b.bonusEarned>0 && b.paymentStatus==='paid' && b.status==='completed')history.push({id:b.id+'-earn',title:'Начисление · '+b.serviceName,amount:b.bonusEarned,date:b.paidCompletedAt.slice(0,10)});
    }
    return history.sort((a,b)=>b.date.localeCompare(a.date));
  }
  async function getRedemptionQuote(price,useBonuses){
    const {balance}=await getLoyaltyBalance();
    const applied=useBonuses ? Math.min(Math.max(0,price),Math.max(0,balance)) : 0;
    return {balance,applied,payable:Math.max(0,price-applied),remaining:balance-applied};
  }
  return { getLoyaltyBalance, getLoyaltyHistory, getRedemptionQuote };
})();
