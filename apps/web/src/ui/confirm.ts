export const CONFIRM_KEYS = {
  publish: "suppress_confirm_publish",
  submit: "suppress_confirm_submit",
  approve: "suppress_confirm_approve",
  return: "suppress_confirm_return",
  export: "suppress_confirm_export",
} as const;

export type ConfirmSuppressKey = (typeof CONFIRM_KEYS)[keyof typeof CONFIRM_KEYS];

export function shouldSuppressConfirm(key: ConfirmSuppressKey): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.sessionStorage.getItem(key) === "1";
}

export function suppressConfirmForSession(key: ConfirmSuppressKey): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(key, "1");
}
