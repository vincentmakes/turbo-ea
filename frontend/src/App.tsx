import { Routes, Route } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./features/dashboard/Dashboard";
import FactSheetGrid from "./features/fact-sheets/FactSheetGrid";
import FactSheetDetail from "./features/fact-sheets/FactSheetDetail";
import CapabilityMap from "./features/capabilities/CapabilityMap";
import TechRadar from "./features/technology/TechRadar";
import RiskMatrix from "./features/technology/RiskMatrix";
import ProviderDirectory from "./features/technology/ProviderDirectory";
import DataFlowDiagram from "./features/integration/DataFlowDiagram";
import CrudMatrix from "./features/integration/CrudMatrix";
import InterfaceCircleMap from "./features/integration/InterfaceCircleMap";
import InitiativeKanban from "./features/strategy/InitiativeKanban";
import RoadmapTimeline from "./features/strategy/RoadmapTimeline";
import TimeModel from "./features/strategy/TimeModel";
import Traceability from "./features/strategy/Traceability";
import LandscapeReport from "./features/reports/LandscapeReport";
import MatrixReport from "./features/reports/MatrixReport";
import Settings from "./features/settings/Settings";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="fact-sheets" element={<FactSheetGrid />} />
        <Route path="fact-sheets/:id" element={<FactSheetDetail />} />
        <Route path="capability-map" element={<CapabilityMap />} />
        <Route path="tech-radar" element={<TechRadar />} />
        <Route path="risk-matrix" element={<RiskMatrix />} />
        <Route path="providers" element={<ProviderDirectory />} />
        <Route path="data-flow" element={<DataFlowDiagram />} />
        <Route path="crud-matrix" element={<CrudMatrix />} />
        <Route path="interface-map" element={<InterfaceCircleMap />} />
        <Route path="initiative-board" element={<InitiativeKanban />} />
        <Route path="roadmap" element={<RoadmapTimeline />} />
        <Route path="time-model" element={<TimeModel />} />
        <Route path="traceability" element={<Traceability />} />
        <Route path="landscape-report" element={<LandscapeReport />} />
        <Route path="matrix-report" element={<MatrixReport />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
