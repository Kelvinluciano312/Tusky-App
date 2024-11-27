import React from 'react';
import { Routes, Route } from 'react-router-dom';
import PageOne from '../pages/PageOne';
import PageTwo from '../pages/PageTwo';
import PageThree from '../pages/PageThree';

const AppRoutes: React.FC = () => (
  <Routes>
    <Route path="/" element={<PageOne />} />
    <Route path="/page-two" element={<PageTwo />} />
    <Route path="/page-three" element={<PageThree />} />
  </Routes>
);

export default AppRoutes;
