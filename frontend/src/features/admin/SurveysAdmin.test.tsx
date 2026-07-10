import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn() },
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
