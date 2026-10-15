import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";

import DeleteSurveyDialog from "./DeleteSurveyDialog";

const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(key, { ...(opts ?? {}), interpolation: { escapeValue: false } } as never));

const SURVEY = { id: "s1", name: "Q3 review" };
const IMPACT = "/surveys/s1/delete-impact";

function renderDialog(survey: typeof SURVEY | null = SURVEY) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const view = renderWithProviders(
    <DeleteSurveyDialog survey={survey} onClose={onClose} onDeleted={onDeleted} />,
  );
  return { ...view, onClose, onDeleted };
}

beforeEach(() => {
  mockApi.reset();
});

describe("DeleteSurveyDialog", () => {
  it("stays closed and asks for nothing without a survey", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("names the survey and states what the delete takes with it", async () => {
    mockApi.on("get", IMPACT, { status: "active", requests: 5, pending: 2, answered: 3, applied: 1 });
    renderDialog();

    expect(
      await screen.findByText(t("admin:surveysAdmin.delete.pending", { count: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("admin:surveysAdmin.delete.confirm", { name: "Q3 review" }))).toBeInTheDocument();
    // Three answered, one applied: two answers would be lost.
    expect(screen.getByText(t("admin:surveysAdmin.delete.unapplied", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("admin:surveysAdmin.delete.applied", { count: 1 }))).toBeInTheDocument();
  });

  it("says nothing extra for a draft no one was asked about", async () => {
    mockApi.on("get", IMPACT, { status: "draft", requests: 0, pending: 0, answered: 0, applied: 0 });
    renderDialog();

    await waitFor(() => expect(mockApi.callsOf("get", IMPACT)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not call a closed survey's unanswered requests withdrawn", async () => {
    // Nobody could answer them any more, so the delete withdraws nothing.
    mockApi.on("get", IMPACT, { status: "closed", requests: 3, pending: 2, answered: 1, applied: 0 });
    renderDialog();

    expect(
      await screen.findByText(t("admin:surveysAdmin.delete.unapplied", { count: 1 })),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t("admin:surveysAdmin.delete.pending", { count: 2 })),
    ).not.toBeInTheDocument();
  });

  it("deletes and reports back", async () => {
    mockApi.on("get", IMPACT, { status: "closed", requests: 1, pending: 0, answered: 1, applied: 1 });
    mockApi.on("delete", "/surveys/s1", undefined);
    const { user, onDeleted, onClose } = renderDialog();

    await screen.findByText(t("admin:surveysAdmin.delete.applied", { count: 1 }));
    await user.click(screen.getByRole("button", { name: t("common:actions.delete") }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("delete", "/surveys/s1")).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the error and lets the user cancel when the delete fails", async () => {
    mockApi.on("get", IMPACT, { status: "active", requests: 1, pending: 1, answered: 0, applied: 0 });
    mockApi.fail("delete", "/surveys/s1", 500, "nope");
    const { user, onDeleted, onClose } = renderDialog();

    await screen.findByText(t("admin:surveysAdmin.delete.pending", { count: 1 }));
    await user.click(screen.getByRole("button", { name: t("common:actions.delete") }));

    expect(await screen.findByText(/failed/)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("common:actions.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
