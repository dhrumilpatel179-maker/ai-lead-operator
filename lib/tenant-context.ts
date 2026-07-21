export const DEMO_TENANT_ID = "tenant_northstar_auto_care";

export function tenantContext(request: Request) {
  const authenticatedEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  return {
    tenantId: DEMO_TENANT_ID,
    actorId: authenticatedEmail || "private-demo-owner",
    authenticationSource: authenticatedEmail ? "siwc" : "private-demo-access",
  };
}
