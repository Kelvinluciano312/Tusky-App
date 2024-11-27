import React from "react";
import App from "../App1";
import { QuickstartProvider } from "../Context/index";

// Plaid Configuration (if needed for other parts of PageThree)
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": "your_client_id",
      "PLAID-SECRET": "your_secret",
    },
  },
});
const plaidClient = new PlaidApi(configuration);

const PageThree: React.FC = () => {
  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h1>Page 3</h1>
      <p>Welcome to Page 3 of the app.</p>

      {/* Embedding React.StrictMode */}
      <div style={{ border: "1px solid black", padding: "20px", marginTop: "20px" }}>
        <React.StrictMode>
          <QuickstartProvider>
            <App />
          </QuickstartProvider>
        </React.StrictMode>
      </div>
    </div>
  );
};

export default PageThree;