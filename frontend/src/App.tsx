import { Routes, Route } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./features/dashboard/Dashboard";
import FactSheetGrid from "./features/fact-sheets/FactSheetGrid";
import FactSheetDetail from "./features/fact-sheets/FactSheetDetail";
import CapabilityMap from "./features/capabilities/CapabilityMap";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="fact-sheets" element={<FactSheetGrid />} />
        <Route path="fact-sheets/:id" element={<FactSheetDetail />} />
        <Route path="capability-map" element={<CapabilityMap />} />
      </Route>
    </Routes>
  );
}

export default App;
