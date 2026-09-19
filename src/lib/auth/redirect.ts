/** Accept only same-origin absolute paths for post-auth navigation. */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
}
