// Who the plan is for and who to call: shown on the welcome card before the
// tour. Comes from the plan file's "project" block or from the page address
// (?project=…&address=…&contact=…&phone=…&email=…); the address wins.

export type Project = { name?: string; address?: string; contactName?: string; phone?: string; email?: string };

const text = (v: unknown, max = 120): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || undefined;
};
const email = (v: unknown) => {
  const t = text(v, 200);
  return t && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(t) ? t : undefined;
};
const phone = (v: unknown) => {
  const t = text(v, 40);
  return t && /^\+?[\d\s()./-]{5,}$/.test(t) ? t : undefined;
};

/** Merges the plan's project block with the page address. Returns null when there is nothing to show. */
export function projectFrom(params: { get(name: string): string | null }, block: unknown): Project | null {
  const b = (typeof block === "object" && block !== null ? block : {}) as Record<string, unknown>;
  const c = (typeof b.contact === "object" && b.contact !== null ? b.contact : {}) as Record<string, unknown>;
  const p: Project = {
    name: text(params.get("project")) ?? text(b.name),
    address: text(params.get("address")) ?? text(b.address),
    contactName: text(params.get("contact")) ?? text(c.name),
    phone: phone(params.get("phone")) ?? phone(c.phone),
    email: email(params.get("email")) ?? email(c.email),
  };
  return Object.values(p).some(Boolean) ? p : null;
}

/** Where the Contact button leads: an e-mail when there is an address, else a phone call. */
export function contactHref(p: Project): string | null {
  if (p.email) return `mailto:${p.email}${p.name ? `?subject=${encodeURIComponent(p.name)}` : ""}`;
  if (p.phone) return `tel:${p.phone.replace(/[^\d+]/g, "")}`;
  return null;
}
