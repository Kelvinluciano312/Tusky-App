import React from 'react';

const accounts = [
  { name: 'Chase Checking', mask: '4821', balance: 3245.67, type: 'checking' },
  { name: 'Chase Savings', mask: '9034', balance: 12890.12, type: 'savings' },
];

const transactions = [
  { name: 'Payroll Direct Deposit', date: 'May 20', amount: 2400.00, positive: true, category: 'Income' },
  { name: 'Whole Foods Market', date: 'May 19', amount: -67.43, positive: false, category: 'Food & Dining' },
  { name: 'Netflix', date: 'May 18', amount: -15.49, positive: false, category: 'Entertainment' },
  { name: 'Amazon', date: 'May 17', amount: -89.99, positive: false, category: 'Shopping' },
  { name: 'Starbucks', date: 'May 16', amount: -5.25, positive: false, category: 'Food & Dining' },
  { name: 'Venmo Transfer', date: 'May 15', amount: -50.00, positive: false, category: 'Transfer' },
  { name: 'Spotify', date: 'May 14', amount: -10.99, positive: false, category: 'Entertainment' },
];

const fmt = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const PageOne: React.FC = () => {
  const total = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <div style={{ padding: '20px 16px 100px', maxWidth: 500, margin: '0 auto' }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, opacity: 0.6 }}>Good morning,</p>
      <h2 style={{ margin: '0 0 20px', fontSize: 22 }}>Demo User</h2>

      <div style={{ background: 'linear-gradient(135deg,#007bff,#0056b3)', borderRadius: 16, padding: '20px 24px', color: '#fff', marginBottom: 24 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1 }}>Total Balance</p>
        <p style={{ margin: 0, fontSize: 34, fontWeight: 700 }}>{fmt(total)}</p>
        <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.7 }}>Across {accounts.length} accounts</p>
      </div>

      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Accounts</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {accounts.map(a => (
          <div key={a.mask} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', background: 'var(--button-bg-color)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{a.name}</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.55 }}>···· {a.mask} · {a.type}</p>
            </div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{fmt(a.balance)}</p>
          </div>
        ))}
      </div>

      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Recent Transactions</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {transactions.map((t, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{t.name}</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.5 }}>{t.date} · {t.category}</p>
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: t.positive ? '#16a34a' : 'inherit' }}>
              {t.positive ? '+' : ''}{fmt(t.amount)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PageOne;
