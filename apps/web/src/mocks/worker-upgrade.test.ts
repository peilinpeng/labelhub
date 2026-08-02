import { describe, expect, it, vi } from "vitest";
import { installMockWorkerUpgradeReload } from "./worker-upgrade";

class FakeServiceWorkerContainer extends EventTarget {
  controller: ServiceWorker | null;

  constructor(controlled: boolean) {
    super();
    this.controller = controlled ? ({} as ServiceWorker) : null;
  }
}

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: vi.fn(() => value),
    removeItem: vi.fn(() => {
      value = null;
    }),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe("installMockWorkerUpgradeReload", () => {
  it("reloads an existing client exactly once after the worker controller changes", () => {
    const serviceWorker = new FakeServiceWorkerContainer(true);
    const storage = createStorage();
    const reload = vi.fn();

    installMockWorkerUpgradeReload(serviceWorker, storage, reload);
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    serviceWorker.dispatchEvent(new Event("controllerchange"));

    expect(storage.setItem).toHaveBeenCalledWith(
      "labelhub:msw-worker-upgrade-reload",
      "pending",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a page that has no previous worker controller", () => {
    const serviceWorker = new FakeServiceWorkerContainer(false);
    const storage = createStorage();
    const reload = vi.fn();

    installMockWorkerUpgradeReload(serviceWorker, storage, reload);
    serviceWorker.dispatchEvent(new Event("controllerchange"));

    expect(reload).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("clears the marker on the reloaded page to prevent a reload loop", () => {
    const serviceWorker = new FakeServiceWorkerContainer(true);
    const storage = createStorage("pending");
    const reload = vi.fn();

    installMockWorkerUpgradeReload(serviceWorker, storage, reload);
    serviceWorker.dispatchEvent(new Event("controllerchange"));

    expect(storage.removeItem).toHaveBeenCalledWith(
      "labelhub:msw-worker-upgrade-reload",
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
