import React from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import logo from '../assets/Oldpng.png'; // Adjust path based on folder structure

const Header: React.FC = () => (
  <header>
    <SignedOut>
      <div className="login-container">
        <div className="logo">
          <img src={logo} alt="App Logo" style={{ width: '200px', height: '200px', marginTop: '-80px' }} />
        </div>
        <SignInButton />
      </div>
    </SignedOut>
    <SignedIn>
      <div className="user-container">
        <UserButton />
      </div>
    </SignedIn>
  </header>
);

export default Header;
