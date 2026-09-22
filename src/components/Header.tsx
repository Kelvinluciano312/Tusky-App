import React from 'react';
import logo from '../assets/Oldpng.png';

const Header: React.FC = () => (
  <header>
    <div className="logo">
      <img src={logo} alt="App Logo" style={{ width: '200px', height: '200px', marginTop: '-80px' }} />
    </div>
  </header>
);

export default Header;
