export function isProTier(): boolean {
  if (import.meta.env.VITE_TIER === "pro") return true;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tier") === "pro") return true;
  }
  return false;
}
