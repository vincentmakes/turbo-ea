/**
 * ProcessFlowEditorPage — Full-page BPMN editor route.
 * Route: /bpm/processes/:id/flow
 */
import { useParams, useNavigate } from "react-router-dom";
import BpmnModeler from "./BpmnModeler";

export default function ProcessFlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) return null;

  return (
    <BpmnModeler
      processId={id}
      onBack={() => navigate(`/fact-sheets/${id}`)}
      onSaved={(version) => {
        console.log(`Diagram saved: v${version}`);
      }}
    />
  );
}
