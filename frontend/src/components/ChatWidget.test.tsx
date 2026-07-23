import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatPoll } from "@/lib/api";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/api", () => ({
  chatPoll: vi.fn(),
  chatSend: vi.fn().mockResolvedValue({ session: 1, status: "bot", messages: [] }),
  getAlbum: vi.fn(),
}));

import ChatWidget from "./ChatWidget";

const poll = vi.mocked(chatPoll);

describe("ChatWidget image gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides the attach control while the bot is handling the chat", async () => {
    poll.mockResolvedValue({ session: 1, status: "bot", messages: [] });
    render(<ChatWidget />);
    fireEvent.click(screen.getByLabelText("চ্যাট করুন"));
    // give the poll a tick, then assert no attach button
    await waitFor(() => expect(poll).toHaveBeenCalled());
    expect(screen.queryByLabelText("ছবি যুক্ত করুন")).not.toBeInTheDocument();
  });

  it("shows the attach control once an admin has taken over", async () => {
    poll.mockResolvedValue({ session: 1, status: "admin", messages: [] });
    render(<ChatWidget />);
    fireEvent.click(screen.getByLabelText("চ্যাট করুন"));
    await waitFor(() =>
      expect(screen.getByLabelText("ছবি যুক্ত করুন")).toBeInTheDocument(),
    );
  });
});
