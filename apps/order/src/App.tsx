import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { OrderScreen } from './screens/OrderScreen.js';
import { StallScreen } from './screens/StallScreen.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:slug" element={<StallScreen />} />
        <Route path="/o/:id" element={<OrderScreen />} />
        <Route path="*" element={<NoQr />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Someone reached the site without scanning anything. */
function NoQr() {
  return (
    <div className="plain">
      <h1 className="plain__title">Scan the stall’s code</h1>
      <p className="plain__body">
        Point your camera at the QR code on the stall to see the menu and order.
      </p>
    </div>
  );
}
