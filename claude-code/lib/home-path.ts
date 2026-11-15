// Shared $HOME -> "~" abbreviation.
//
// Requires an exact match or a "/" boundary — without it, a sibling path
// like /Users/inouetsukasa-old/x would abbreviate to ~-old/x.

export function abbreviateHome(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return `~${p.slice(home.length)}`;
  return p;
}
