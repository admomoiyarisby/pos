// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { AuthProvider, type AuthUser } from "#/lib/auth-context";
import { AuthSessionWatcher } from "#/components/AuthSessionWatcher";

const { getCurrentUserMock, invalidateMock, mockRouter } = vi.hoisted(() => {
  const invalidateMock = vi.fn(async () => undefined);
  return {
    getCurrentUserMock: vi.fn(),
    invalidateMock,
    // Stable instance, mirroring the real useRouter return.
    mockRouter: { invalidate: invalidateMock },
  };
});

vi.mock("#/lib/server/auth", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => mockRouter,
}));

const superAdmin: AuthUser = {
  id: "u-admin",
  email: "superadmin@omoiyari.net",
  name: "Super Admin",
  role: "super_admin",
  branchId: undefined,
  assignedBranches: undefined,
  pin: "1111",
  status: "Active",
};

const branchAdmin: AuthUser = {
  id: "u-branch",
  email: "andi.wiyung@omoiyari.net",
  name: "Andi",
  role: "branch_admin",
  branchId: "branch-wiyung",
  assignedBranches: undefined,
  pin: "1234",
  status: "Active",
};

function renderWatcher(snapshot: AuthUser | null) {
  return render(
    <AuthProvider user={snapshot} isLoading={false}>
      <AuthSessionWatcher />
    </AuthProvider>,
  );
}

async function focusWindow() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

async function setDocumentVisible(visible: boolean) {
  await act(async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(visible ? "visible" : "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  getCurrentUserMock.mockReset();
  invalidateMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuthSessionWatcher", () => {
  it("invalidates when the live session role differs from the snapshot role", async () => {
    renderWatcher(superAdmin);
    getCurrentUserMock.mockResolvedValue(branchAdmin);

    await focusWindow();

    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledTimes(1));
  });

  it("does NOT invalidate when the live session matches the snapshot", async () => {
    renderWatcher(superAdmin);
    getCurrentUserMock.mockResolvedValue(superAdmin);

    await focusWindow();

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("invalidates when the session is signed out (live null) while the page still shows a user", async () => {
    renderWatcher(superAdmin);
    getCurrentUserMock.mockResolvedValue(null);

    await focusWindow();

    await waitFor(() => expect(invalidateMock).toHaveBeenCalledTimes(1));
  });

  it("invalidates when a different user holds the session, even with the same role", async () => {
    const otherSuperAdmin: AuthUser = {
      ...superAdmin,
      id: "u-admin-2",
      email: "admin2@omoiyari.net",
      name: "Admin Dua",
    };
    renderWatcher(superAdmin);
    getCurrentUserMock.mockResolvedValue(otherSuperAdmin);

    await focusWindow();

    await waitFor(() => expect(invalidateMock).toHaveBeenCalledTimes(1));
  });

  it("does NOT invalidate for display-only drift (name/email change, same identity)", async () => {
    renderWatcher(superAdmin);
    getCurrentUserMock.mockResolvedValue({
      ...superAdmin,
      name: "Super Admin (Renamed)",
      email: "renamed@omoiyari.net",
    });

    await focusWindow();

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("re-checks on visibilitychange to visible and invalidates on a mismatch", async () => {
    renderWatcher(superAdmin);
    getCurrentUserMock.mockResolvedValue(branchAdmin);

    // Switching to hidden must not trigger a check…
    await setDocumentVisible(false);
    expect(getCurrentUserMock).not.toHaveBeenCalled();

    // …but becoming visible again re-validates against the live session.
    await setDocumentVisible(true);
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledTimes(1));
  });

  it("dedupes overlapping checks while one is in flight", async () => {
    let resolveLive!: (user: AuthUser | null) => void;
    getCurrentUserMock.mockReturnValue(
      new Promise<AuthUser | null>((resolve) => {
        resolveLive = resolve;
      }),
    );
    renderWatcher(superAdmin);

    // Two focus events fire before the first session fetch resolves.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLive(branchAdmin);
    });
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledTimes(1));
  });
});
