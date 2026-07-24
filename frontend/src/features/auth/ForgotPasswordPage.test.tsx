import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ForgotPasswordPage from "./ForgotPasswordPage";

vi.mock("@/api/client", () => ({
  auth: {
    forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { auth } from "@/api/client";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/auth/forgot-password"]}>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the email form initially", () => {
    renderPage();
    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("submits and shows success state regardless of backend (anti-enumeration)", async () => {
    renderPage();
    const input = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "user@example.com" } });

    const submit = screen.getAllByRole("button").find((b) =>
      /(send|envoyer|enviar|invia|发送|отправить)/i.test(b.textContent || ""),
    )!;
    fireEvent.click(submit);

    await waitFor(() => {
      expect(auth.forgotPassword).toHaveBeenCalledWith("user@example.com");
    });
    // After submit, the success state replaces the form — the email input
    // is no longer in the DOM.
    await waitFor(() => {
      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    });
  });

  it("still shows success when the backend errors out", async () => {
    (auth.forgotPassword as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network down"),
    );
    renderPage();
    const input = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "user@example.com" } });
    const submit = screen.getAllByRole("button").find((b) =>
      /(send|envoyer|enviar|invia|发送|отправить)/i.test(b.textContent || ""),
    )!;
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    });
  });
});
