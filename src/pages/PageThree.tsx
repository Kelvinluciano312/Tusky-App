import React, { useState } from 'react';
import { ShieldCheck, Lock } from 'lucide-react';

const banks = [
  { name: 'Chase', color: '#003087' },
  { name: 'Bank of America', color: '#e31837' },
  { name: 'Wells Fargo', color: '#d71e28' },
  { name: 'Citi', color: '#003b70' },
  { name: 'Capital One', color: '#d03027' },
  { name: 'US Bank', color: '#0c2074' },
];

const PageThree: React.FC = () => {
  const [step, setStep] = useState<'list' | 'connecting' | 'done'>('list');
  const [selected, setSelected] = useState('');

  const connect = (name: string) => {
    setSelected(name);
    setStep('connecting');
    setTimeout(() => setStep('done'), 1800);
  };

  if (step === 'connecting') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
      <div style={{ width: 48, height: 48, border: '3px solid rgba(0,123,255,0.2)', borderTop: '3px solid #007bff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Connecting to {selected}…</p>
      <p style={{ margin: 0, fontSize: 13, opacity: 0.5 }}>Securely linking your account</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (step === 'done') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ShieldCheck color="#16a34a" size={28} />
      </div>
      <h3 style={{ margin: 0, fontSize: 20 }}>Account Linked!</h3>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.6, textAlign: 'center', maxWidth: 260 }}>{selected} has been securely connected via Plaid.</p>
      <button onClick={() => setStep('list')} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 10, background: '#007bff', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        Link Another
      </button>
    </div>
  );

  return (
    <div style={{ padding: '20px 16px 100px', maxWidth: 500, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Link Account</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, opacity: 0.55 }}>Connect a bank account via Plaid</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe', marginBottom: 24 }}>
        <Lock color="#3b82f6" size={16} />
        <p style={{ margin: 0, fontSize: 13, color: '#1e40af' }}>Your credentials are never stored. Plaid uses bank-grade encryption.</p>
      </div>

      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Select your bank</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {banks.map(b => (
          <button
            key={b.name}
            onClick={() => connect(b.name)}
            style={{ padding: '16px 12px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', background: 'var(--button-bg-color)', cursor: 'pointer', textAlign: 'left', transition: 'transform 0.15s' }}
            onMouseOver={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
            onMouseOut={e => (e.currentTarget.style.transform = 'none')}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: b.color, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{b.name}</p>
          </button>
        ))}
      </div>

      <p style={{ marginTop: 24, textAlign: 'center', fontSize: 12, opacity: 0.45 }}>Powered by <strong>Plaid</strong></p>
    </div>
  );
};

export default PageThree;
