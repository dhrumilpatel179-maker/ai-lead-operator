import { and, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { tenantMemberships, tenants, type roles } from "../db/schema";

export type Role = (typeof roles)[number];

export type RequestContext = {
  tenantId: string;
  tenantName: string;
  actorId: string;
  role: Role;
  authenticationSource: "sites-siwc";
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function authenticatedEmail(request: Request): string {
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (!email) {
    throw new HttpError(401, "authentication_required", "Sign in is required.");
  }
  return email;
}

export async function resolveRequestContext(
  request: Request,
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<RequestContext> {
  const email = authenticatedEmail(request);
  const memberships = await db
    .select({
      tenantId: tenantMemberships.tenantId,
      tenantName: tenants.name,
      role: tenantMemberships.role,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.userEmail, email)))
    .limit(2);

  if (memberships.length === 0) {
    throw new HttpError(403, "membership_required", "No workspace membership is assigned.");
  }
  if (memberships.length > 1) {
    throw new HttpError(
      409,
      "workspace_selection_required",
      "Multiple workspace memberships require a server-managed active workspace.",
    );
  }

  const membership = memberships[0];
  return {
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    actorId: email,
    role: membership.role,
    authenticationSource: "sites-siwc",
  };
}

export function requireRole(
  context: RequestContext,
  allowed: readonly Role[],
): void {
  if (!allowed.includes(context.role)) {
    throw new HttpError(403, "role_forbidden", "Your role cannot perform this action.");
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }

  console.error("Fail-closed request error", error);
  return Response.json(
    {
      error: "persistence_unavailable",
      message: "The operation was not completed. Try again later.",
    },
    { status: 503 },
  );
}

