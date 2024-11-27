import React from "react";
import App from "../App1";
import { QuickstartProvider } from "../Context";

const QuickstartRoot: React.FC = () => {
  return (
    <QuickstartProvider>
      <App />
    </QuickstartProvider>
  );
};

export default QuickstartRoot;