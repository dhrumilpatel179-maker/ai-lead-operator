import type { AuthorityLevel } from "./workflow";

const rank: Record<AuthorityLevel, number> = { green: 0, yellow: 1, red: 2 };

export function highestAuthority(...levels: AuthorityLevel[]): AuthorityLevel {
  return levels.reduce((highest, level) =>
    rank[level] > rank[highest] ? level : highest,
  "green");
}

export function classifyOutboundContent(body: string): AuthorityLevel {
  const text = body.toLowerCase();
  const red = [
    /\b(?:diagnos(?:e|ed|is)|the problem is|caused by|needs? a new)\b/,
    /\b(?:guarantee|guaranteed|promise|definitely)\b.{0,32}\b(?:price|cost|ready|finish|complete|repair)\b/,
    /\b(?:refund|warranty dispute|legal settlement|financial commitment)\b/,
    /\b(?:safe to drive|keep driving|drive it in)\b/,
    /\bshare\b.{0,24}\b(?:customer|personal) data\b/,
  ].some((pattern) => pattern.test(text));
  if (red) return "red";

  const yellow = [
    /[$€£]\s*\d|\b(?:estimate|approximately|around)\s+\d/,
    /\b(?:appointment|booked|scheduled|available at)\b/,
    /\b(?:complaint|policy exception|discount)\b/,
  ].some((pattern) => pattern.test(text));

  return yellow ? "yellow" : "green";
}

export function canMutate(role: string): boolean {
  return role === "owner" || role === "manager" || role === "advisor";
}

