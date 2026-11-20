import { createBrowserRouter } from 'react-router';

import { Layout } from '@/components/Layout';
import { AccountPage } from './AccountPage';
import { HomePage } from './HomePage';
import { NotFound } from './NotFound';
import { PaymentPage } from './PaymentPage';
import { TransactionPage } from './TransactionPage';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/accounts/:code', element: <AccountPage /> },
      { path: '/transactions/:id', element: <TransactionPage /> },
      { path: '/payments/:id', element: <PaymentPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
