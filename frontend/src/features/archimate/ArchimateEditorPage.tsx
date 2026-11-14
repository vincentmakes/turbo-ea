/**
 * ArchimateEditorPage — full-page ArchiMate editor route.
 * Route: /admin/architectureStudio/:id
 *
 * Keyed by the diagram id so the editor (a diagram-js instance with its own undo stack and dirty
 * state) is rebuilt, never reused, when the URL moves from one diagram to another.
 */
import { useNavigate, useParams } from "react-router";
import { routePermissionsFor } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { canAccessPath } from "@/lib/routePermissions";
import ArchimateModeler from "./ArchimateModeler";

export default function ArchimateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useOptionalAuthUser();

  if (!id) return null;

  // Back returns to where the user came from. react-router's `idx` counts in-app entries (an SSO
  // login replaces the entry, so `location.key` cannot tell a deep link); a role without
  // `diagrams.view` has no /diagrams to land on, so it gets the studio list.
  const onBack = () => {
    const inApp = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
    const fallback = canAccessPath(routePermissionsFor(user), "/diagrams")
      ? "/diagrams"
      : "/admin/architectureStudio";
    if (inApp) navigate(-1);
    else navigate(fallback);
  };

  return <ArchimateModeler key={id} diagramId={id} onBack={onBack} />;
}
