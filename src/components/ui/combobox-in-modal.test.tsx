// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import Modal from "#/components/ui/Modal";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "#/components/ui/combobox";

interface PickOption {
  id: string;
  name: string;
}

const OPTIONS: PickOption[] = [{ id: "opt-1", name: "Bahan A" }];

function ComboboxInModal() {
  return (
    <Modal open onClose={() => {}} title="Tambah Grup Modifier">
      <Combobox
        open
        items={OPTIONS}
        itemToStringValue={(item: PickOption | null) => item?.id ?? ""}
        itemToStringLabel={(item: PickOption | null) => item?.name ?? ""}
        isItemEqualToValue={(a, b) => a?.id === b?.id}
      >
        <ComboboxInput placeholder="Cari bahan…" />
        <ComboboxContent>
          <ComboboxList>
            {(item: PickOption) => (
              <ComboboxItem key={item.id} value={item}>
                <span>{item.name}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Modal>
  );
}

afterEach(() => {
  cleanup();
  // Radix restores this on unmount, but reset explicitly so a failing test
  // can't leak `pointer-events: none` into other tests.
  document.body.style.pointerEvents = "";
});

describe("Combobox inside Modal", () => {
  it("keeps the dropdown hit-testable while the modal disables body pointer events", () => {
    render(<ComboboxInModal />);

    // Radix modal Dialogs trap pointer interaction by setting
    // `body { pointer-events: none }`. This documents the trap the fix
    // defends against — if Radix changes behavior, this fails loudly.
    expect(document.body.style.pointerEvents).toBe("none");

    // The dropdown portals to `body`, so it must explicitly opt back into
    // hit-testing or its items can't be clicked and the list can't be
    // scrolled with a mouse (keyboard keeps working, which is why this only
    // showed up as a mouse bug). Regression test for the creation-modal
    // searchbox, which the edit page (no Modal) never suffered from.
    const popup = document.querySelector('[data-slot="combobox-content"]');
    expect(popup).not.toBeNull();
    expect(popup!.closest(".pointer-events-auto")).not.toBeNull();
  });

  it("lets the mouse wheel scroll the dropdown instead of being swallowed by the modal scroll-lock", () => {
    render(<ComboboxInModal />);

    const list = document.querySelector('[data-slot="combobox-list"]');
    expect(list).not.toBeNull();

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    list!.dispatchEvent(event);

    // Radix scroll-locks the page while a modal is open via a `wheel`
    // listener on `document` that calls `preventDefault()` on anything
    // outside the dialog content — and a preventDefaulted wheel never
    // scrolls. The dropdown must stop propagation so the gesture reaches
    // the list. Regression test for the creation-modal searchbox wheel.
    expect(event.defaultPrevented).toBe(false);
  });
});
