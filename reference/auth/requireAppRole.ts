import type { HttpRequest } from "@azure/functions";
import type { JWTPayload } from "jose";
import { validateAccessToken } from "./validateAccessToken";
import { auditBusinessRequest } from "./businessRequestAudit";
import { checkStaffAccess } from "./staffAccess";
import { rememberVerifiedReadActor } from "./verifiedReadActor";

type RoleCheckSuccess = {
  ok: true;
  claims: JWTPayload;
  roles: string[];
  requiredRoles: string[];
  matchedRole: string;
};

type RoleCheckFailure = {
  ok: false;
  status: number;
  error: string;
};

function getRolesFromClaims(claims: JWTPayload): string[] {
  const rolesClaim = claims.roles;

  if (!Array.isArray(rolesClaim)) {
    return [];
  }

  return rolesClaim.filter((role): role is string => typeof role === "string");
}

function normalizeRequiredRoles(requiredRoles: string | readonly string[]) {
  const normalizedRoles = Array.isArray(requiredRoles)
    ? requiredRoles
    : [requiredRoles];

  return normalizedRoles
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}

export async function requireAnyAppRole(
  request: HttpRequest,
  requiredRoles: string | readonly string[],
  dependencies = { validateAccessToken, auditBusinessRequest, checkStaffAccess }
): Promise<RoleCheckSuccess | RoleCheckFailure> {
  const normalizedRequiredRoles = normalizeRequiredRoles(requiredRoles);

  if (normalizedRequiredRoles.length === 0) {
    return {
      ok: false,
      status: 500,
      error: "API route is missing required app role configuration.",
    };
  }

  const tokenResult = await dependencies.validateAccessToken(request);

  if (!tokenResult.ok) {
    return tokenResult;
  }

  const roles = getRolesFromClaims(tokenResult.claims);
  const matchedRole =
    normalizedRequiredRoles.find((requiredRole) =>
      roles.includes(requiredRole)
    ) ?? null;

  if (!matchedRole) {
    return {
      ok: false,
      status: 403,
      error: `User is missing required app role. Required one of: ${normalizedRequiredRoles.join(
        ", "
      )}`,
    };
  }

  try {
    if (!await dependencies.checkStaffAccess(tokenResult.claims.oid)) {
      return { ok: false, status: 403, error: "Your platform access is unavailable. Contact an administrator." };
    }
    await dependencies.auditBusinessRequest(request, tokenResult.claims.oid, matchedRole);
    rememberVerifiedReadActor(request, tokenResult.claims.oid, matchedRole);
  } catch {
    return { ok: false, status: 503, error: "Staff access verification is unavailable. Please try again." };
  }

  return {
    ok: true,
    claims: tokenResult.claims,
    roles,
    requiredRoles: normalizedRequiredRoles,
    matchedRole,
  };
}

export async function requireAppRole(
  request: HttpRequest,
  requiredRole: string
): Promise<RoleCheckSuccess | RoleCheckFailure> {
  const roleResult = await requireAnyAppRole(request, requiredRole);

  if (!roleResult.ok && roleResult.status === 403 && roleResult.error.startsWith("User is missing required app role.")) {
    return {
      ...roleResult,
      error: `User is missing required app role: ${requiredRole}`,
    };
  }

  return roleResult;
}
