import { Routes, Route } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./features/dashboard/Dashboard";
import FactSheetList from "./features/fact-sheets/FactSheetList";
import FactSheetDetail from "./features/fact-sheets/FactSheetDetail";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="fact-sheets" element={<FactSheetList />} />
        <Route path="fact-sheets/:id" element={<FactSheetDetail />} />
      </Route>
    </Routes>
  );
}

export default App;
