import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NotificationBell from "./NotificationBell";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ items: [], unread_count: 3 }),
    post: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@/hooks/useEventStream", () => ({
  useEventStream: () => {},
}));

function bellButton() {
  return screen.getByRole("button");
}

describe("NotificationBell icon color (#852)", () => {
  it("uses the navbar text color passed via the color prop", () => {
    render(<NotificationBell userId="u1" color="#1A1A2E" />);
    expect(bellButton()).toHaveStyle({ color: "rgb(26, 26, 46)" });
  });

  it("defaults to white when no color is passed (built-in navy navbar)", () => {
    render(<NotificationBell userId="u1" />);
    expect(bellButton()).toHaveStyle({ color: "rgb(255, 255, 255)" });
  });

  it("keeps the unread badge on the theme error color regardless of icon color", () => {
    const { container } = render(<NotificationBell userId="u1" color="#1A1A2E" />);
    expect(container.querySelector(".MuiBadge-colorError")).not.toBeNull();
  });
});
