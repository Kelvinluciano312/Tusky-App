import React from 'react';
import './App.css';
import { SignedIn } from '@clerk/clerk-react';
import Header from './components/Header';
import AppRoutes from './components/AppRoutes';
import Navigation from './components/Navigation';
import { BrowserRouter as Router } from 'react-router-dom';

const App: React.FC = () => (
  <>
    <Header />
    <main>
      <SignedIn>
        <Router>
          <div className="main-container">
            <AppRoutes />
            <Navigation />
          </div>
        </Router>
      </SignedIn>
    </main>
  </>
);

export default App;






