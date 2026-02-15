/**
 * ProcessFlowEditorPage — Full-page BPMN editor route.
 * Route: /bpm/processes/:id/flow
 *
 * Reads ?versionId= query param to edit a specific draft version.
 */
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import BpmnModeler from "./BpmnModeler";

export default function ProcessFlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const versionId = searchParams.get("versionId") || undefined;

  if (!id) return null;

  return (
    <BpmnModeler
      processId={id}
      versionId={versionId}
      onBack={() => navigate(`/fact-sheets/${id}`)}
      onSaved={() => {}}
    />
  );
}
