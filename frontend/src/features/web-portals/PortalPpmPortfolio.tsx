/**
 * The PPM portfolio board as served by a published web portal.
 *
 * The account-less twin of `features/ppm/PpmPortfolio.tsx`: both render the same
 * `PpmPortfolioView`, so an executive without a Turbo EA account sees exactly the
 * board their colleagues see inside the app. They differ in two ways only: this
 * one reads a single unauthenticated round-trip per grouping from the portal's
 * own least-privilege endpoint, and it passes no `shell`, so the board renders
 * bare — no print, no export, and none of the xlsx/pptx engine in this bundle.
 *
 * Rows still link into `/ppm/{id}`, which is deliberate. Signing in with an
 * email and password renders the login form in place at the catch-all route, so
 * the URL never changes and the visitor lands on the initiative they picked;
 * SSO carries the requested path across the identity-provider round trip and
 * arrives at the same place. A visitor whose role cannot open the initiative is
 * redirected to the dashboard with an explanation rather than a blank page.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import PpmPortfolioView from "@/features/ppm/PpmPortfolioView";
import { publicGet } from "./publicApi";
import type {
  PortalPpmPortfolio as PortalPpmPortfolioPayload,
  PpmPortfolioItem,
  PpmPortfolioDashboard,
  PpmPortfolioGroupOption,
  PublicPortal,
} from "@/types";

interface Props {
  slug: string;
  portal: PublicPortal;
}

export default function PortalPpmPortfolio({ slug, portal }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PpmPortfolioItem[]>([]);
  const [dashboard, setDashboard] = useState<PpmPortfolioDashboard | null>(null);
  const [groupOptions, setGroupOptions] = useState<PpmPortfolioGroupOption[]>([]);
  const [groupBy, setGroupBy] = useState("Organization");

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      setLoading(true);
      try {
        const data = await publicGet<PortalPpmPortfolioPayload>(
          `/web-portals/public/${slug}/ppm/portfolio?group_by=${encodeURIComponent(groupBy)}`,
          { signal },
        );
        if (!isCurrent()) return;
        setItems(data.items);
        setDashboard(data.dashboard);
        setGroupOptions(data.group_options);
      } finally {
        // Only the winner clears the spinner, or a superseded request settles
        // the UI over rows the controls say you are not looking at (#882).
        if (isCurrent()) setLoading(false);
      }
    },
    [slug, groupBy],
  );

  const handleOpen = useCallback(
    (item: PpmPortfolioItem, target?: "detail" | "reports") => {
      navigate(target === "reports" ? `/ppm/${item.id}?tab=reports` : `/ppm/${item.id}`);
    },
    [navigate],
  );

  return (
    <PpmPortfolioView
      items={items}
      dashboard={dashboard}
      groupOptions={groupOptions}
      // The portal payload already carries Initiative's subtype definitions —
      // this page has no session to read `/metamodel/types` with.
      subtypeDefs={portal.type_info?.subtypes ?? []}
      loading={loading}
      onGroupByChange={setGroupBy}
      onOpen={handleOpen}
      showTitle={false}
    />
  );
}
