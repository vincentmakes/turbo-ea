import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/useDateFormat", () => ({ useDateFormat: () => ({ formatDate: (d: string) => d }) }));

import { api } from "@/api/client";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

import SurveysAdmin from "./SurveysAdmin";

const mockPost = api.post as ReturnType<typeof vi.fn>;

describe("SurveysAdmin — extension survey templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("hides the template menu when no extension contributes templates", async () => {
    render(<SurveysAdmin />);
    await waitFor(() => expect(screen.getByText(/new survey/i)).toBeInTheDocument());
    expect(screen.queryByText(/new from template/i)).not.toBeInTheDocument();
  });

  it("mints a draft from a template and opens it in the builder", async () => {
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      surveyTemplates: [
        {
          id: "quarterly",
          label: "Quarterly ESG review",
          icon: "event",
          build: () => ({
            name: "Quarterly ESG review",
            target_type_key: "Application",
            fields: [{ key: "esgRating", type: "ext.daaf.rating", action: "maintain" }],
          }),
        },
      ],
    });
    mockPost.mockResolvedValue({ id: "new-survey-id" });
    const user = userEvent.setup();
    render(<SurveysAdmin />);

    await waitFor(() => expect(screen.getByText(/new from template/i)).toBeInTheDocument());
    await user.click(screen.getByText(/new from template/i));
    await user.click(await screen.findByText("Quarterly ESG review"));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/surveys",
        expect.objectContaining({ name: "Quarterly ESG review", target_type_key: "Application" }),
      ),
    );
    expect(navigate).toHaveBeenCalledWith("/admin/surveys/new-survey-id");
  });
});

describe("SurveysAdmin — delete (#1257)", () => {
  const SURVEYS = [
    {
      id: "s-active",
      name: "Q3 review",
      description: "",
      message: "",
      status: "active",
      target_type_key: "Application",
      target_filters: {},
      target_roles: [],
      fields: [],
      total_responses: 4,
      completed_responses: 1,
    },
    {
      id: "s-draft",
      name: "Draft one",
      description: "",
      message: "",
      status: "draft",
      target_type_key: "Application",
      target_filters: {},
      target_roles: [],
      fields: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/delete-impact")
          ? { status: "active", requests: 4, pending: 3, answered: 1, applied: 0 }
          : SURVEYS,
      ),
    );
    (api.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("translates the status chip instead of capitalising the code", async () => {
    render(<SurveysAdmin />);
    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("deletes an active survey from its menu without opening it", async () => {
    const user = userEvent.setup();
    render(<SurveysAdmin />);
    await screen.findByText("Q3 review");

    await user.click(screen.getAllByRole("button", { name: "Survey actions" })[0]);
    expect(navigate).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Q3 review");
    expect(await screen.findByText(/3 requests still waiting/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/surveys/s-active/delete-impact", expect.anything());

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/surveys/s-active"));
    await waitFor(() => expect(screen.queryByText("Q3 review")).not.toBeInTheDocument());
    expect(screen.getByText("Draft one")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("cancelling leaves the survey in place", async () => {
    const user = userEvent.setup();
    render(<SurveysAdmin />);
    await screen.findByText("Q3 review");

    await user.click(screen.getAllByRole("button", { name: "Survey actions" })[1]);
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText("Draft one")).toBeInTheDocument();
  });
});
