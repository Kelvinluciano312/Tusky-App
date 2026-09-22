import React from 'react';

const categories = [
  { name: 'Food & Dining', amount: 340, color: '#ef4444', pct: 35 },
  { name: 'Bills & Utilities', amount: 215, color: '#3b82f6', pct: 22 },
  { name: 'Shopping', amount: 210, color: '#8b5cf6', pct: 22 },
  { name: 'Transportation', amount: 120, color: '#f59e0b', pct: 12 },
  { name: 'Entertainment', amount: 85, color: '#10b981', pct: 9 },
];

const monthly = [
  { month: 'Jan', amount: 1820 },
  { month: 'Feb', amount: 2140 },
  { month: 'Mar', amount: 1690 },
  { month: 'Apr', amount: 2310 },
  { month: 'May', amount: 970 },
];

const maxAmount = Math.max(...monthly.map(m => m.amount));

const PageTwo: React.FC = () => {
  const total = categories.reduce((s, c) => s + c.amount, 0);

  return (
    <div style={{ padding: '20px 16px 100px', maxWidth: 500, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Analytics</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, opacity: 0.55 }}>May 2025 spending</p>

      <div style={{ background: 'var(--button-bg-color)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 16, padding: '20px', marginBottom: 24 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 }}>Total Spent</p>
        <p style={{ margin: '0 0 20px', fontSize: 30, fontWeight: 700 }}>${total.toFixed(2)}</p>

        {categories.map(c => (
          <div key={c.name} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
              <span style={{ fontSize: 13, opacity: 0.7 }}>${c.amount} · {c.pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'rgba(0,0,0,0.08)' }}>
              <div style={{ height: '100%', borderRadius: 99, background: c.color, width: `${c.pct}%`, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Monthly Spending</h3>
      <div style={{ background: 'var(--button-bg-color)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 16, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 120, justifyContent: 'space-around' }}>
          {monthly.map(m => (
            <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
              <span style={{ fontSize: 11, opacity: 0.5 }}>${(m.amount / 1000).toFixed(1)}k</span>
              <div style={{ width: '100%', maxWidth: 40, borderRadius: '6px 6px 0 0', background: m.month === 'May' ? '#007bff' : 'rgba(0,123,255,0.25)', height: `${(m.amount / maxAmount) * 80}px`, transition: 'height 0.4s ease' }} />
              <span style={{ fontSize: 12, fontWeight: m.month === 'May' ? 700 : 400, opacity: m.month === 'May' ? 1 : 0.55 }}>{m.month}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PageTwo;
