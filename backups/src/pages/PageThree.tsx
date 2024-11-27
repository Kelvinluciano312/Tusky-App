import React from 'react';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// Plaid Configuration
const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': 'your_client_id',
        'PLAID-SECRET': 'your_secret',
      },
    },
  });
  const plaidClient = new PlaidApi(configuration);



const PageThree: React.FC = () => {
  return (
    <div style={{ textAlign: 'center', padding: '20px' }}>
      <h1>Page 3</h1>
      <p>Welcome to Page 3 of the app.</p>
    </div>
  );
};

export default PageThree;