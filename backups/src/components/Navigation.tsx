import React from 'react';
import { Link } from 'react-router-dom';
import '../App.css';
import {CheckCheckIcon, List, PieChart } from 'lucide-react';

const Navigation: React.FC = () => (
  <div className="navigation-container">

    <Link to="/" className="nav-button">
        <CheckCheckIcon color="#213547" size={24} />{/* Home icon */}
    </Link>

    <Link to="/page-two" className="nav-button">
        <PieChart color="#213547" size={24} />{/* Home icon */}
    </Link>

    <Link to="/page-three" className="nav-button">
        <List color="#213547" size={24}/>{/* Home icon */}
    </Link>
  </div>
);

export default Navigation;
