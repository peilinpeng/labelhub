const RELOAD_MARKER = "labelhub:msw-worker-upgrade-reload";

type ServiceWorkerController = Pick<
  ServiceWorkerContainer,
  "addEventListener" | "removeEventListener" | "controller"
>;

type SessionStore = Pick<Storage, "getItem" | "removeItem" | "setItem">;

/**
 * MSW workers call skipWaiting() when their generated script changes. A page
 * that was already controlled by the previous worker then receives a
 * controllerchange event, but the new worker has not activated mocking for
 * that client yet. Reload that existing client once so worker.start() can
 * establish a fresh channel with the new worker.
 */
export function installMockWorkerUpgradeReload(
  serviceWorker: ServiceWorkerController = navigator.serviceWorker,
  storage: SessionStore = sessionStorage,
  reload: () => void = () => window.location.reload(),
): () => void {
  if (!serviceWorker.controller) {
    return () => undefined;
  }

  if (storage.getItem(RELOAD_MARKER) === "pending") {
    storage.removeItem(RELOAD_MARKER);
    return () => undefined;
  }

  const handleControllerChange = () => {
    serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    storage.setItem(RELOAD_MARKER, "pending");
    reload();
  };

  serviceWorker.addEventListener("controllerchange", handleControllerChange);
  return () => serviceWorker.removeEventListener("controllerchange", handleControllerChange);
}
