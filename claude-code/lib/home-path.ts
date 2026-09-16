// Shared $HOME <-> "~" mapping. This machine only ever has one HOME, so
// expandHome's inverse mapping is unambiguous.
//
// Both directions require an exact match or a "/" boundary — without it,
// a sibling path like /Users/inouetsukasa-old/x would abbreviate to
// ~-old/x, and "~-old/x" would fail to expand back at all.

export function abbreviateHome(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return `~${p.slice(home.length)}`;
  return p;
}

export function expandHome(p: string | null | undefined, home: string): string {
  if (!p) return "";
  if (p === "~") return home;
  if (p.startsWith("~/")) return home + p.slice(1);
  return p;
}
