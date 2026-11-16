/** Group IPs into provider-sized networks so a whole range can be tagged at once. */
export function networkOf(ip: string): string {
  if (!ip || ip === "Unknown") return "Unknown";
  if (ip.includes(":")) {
    const h = ip.split(":").filter((x, i) => x !== "" || i === 0);
    return `${h[0] ?? ""}:${h[1] ?? "0"}::/32`;
  }
  const o = ip.split(".");
  return o.length === 4 ? `${o[0]}.${o[1]}.x.x` : ip;
}
