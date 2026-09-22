import React from 'react';
import logo from '../assets/Oldpng.png';

const Header: React.FC = () => (
  <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
    <img src={logo} alt="Tusky" style={{ height: '36px', width: 'auto' }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#007bff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px', fontWeight: 600 }}>D</div>
      <span style={{ fontSize: '14px', fontWeight: 500 }}>Demo User</span>
    </div>
  </header>
);

export default Header;
