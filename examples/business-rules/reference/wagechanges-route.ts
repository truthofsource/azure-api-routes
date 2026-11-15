import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { requireAnyAppRole } from "../auth/requireAppRole";
import { withReturnedRecordAudit } from "../auth/returnedRecordAudit";
import { getSqlPool } from "../db/sqlPool";
import { EmployeeProfileError, employeeIdPattern } from "../employees/employeeProfiles";
import { createWageStore, parseWageInput } from "../payroll/wageChanges";
export async function wageChanges(request: HttpRequest, context: InvocationContext, deps = { authorize: requireAnyAppRole, store: async () => createWageStore(await getSqlPool()) }): Promise<HttpResponseInit> {
  const reply = (status: number, jsonBody: unknown) => ({ status, jsonBody, headers: { "Cache-Control": "no-store" } });
  const self = request.method === "GET" && request.query.get("employeeId") === "me";
  const auth = await deps.authorize(request, self ? ["Workforce.Admin", "Workforce.HR", "Workforce.Payroll", "Workforce.Caregiver", "Workforce.Supervisor"] : ["Workforce.Payroll", "Workforce.Admin"]);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    if (request.method === "GET") {
      if (self) {
        if ([...request.query.keys()].some(key => key !== "employeeId")) return reply(400, { error: "This page only shows your own current pay." });
        const actor = auth.claims.oid;
        if (typeof actor !== "string" || !employeeIdPattern.test(actor)) return reply(403, { error: "A verified employee account is required." });
        const store = await deps.store(), employeeId = await store.resolveSelf(actor), rate = await store.current(employeeId);
        return reply(200, { ok: true, employeeId, current: rate ? { hourlyRate: rate.hourlyRate, respiteHourlyRate: rate.respiteHourlyRate ?? null, effectiveDate: rate.effectiveDate } : null });
      }
      const id = request.query.get("employeeId"); if (!id || !employeeIdPattern.test(id)) return reply(400, { error: "Choose an employee." });
      return reply(200, { ok: true, ...await (await deps.store()).list(id) });
    }
    if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
    const actor = auth.claims.oid; if (typeof actor !== "string" || !employeeIdPattern.test(actor)) return reply(403, { error: "A verified staff account is required." });
    if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return reply(415, { error: "Use application/json." });
    const raw = await request.text(); if (Buffer.byteLength(raw, "utf8") > 4096) return reply(413, { error: "Wage request is too large." });
    let body: unknown; try { body = JSON.parse(raw); } catch { return reply(400, { error: "Provide valid JSON." }); }
    return reply(200, { ok: true, change: await (await deps.store()).save(parseWageInput(body), actor, auth.roles, context.invocationId) });
  } catch (error) {
    if (error instanceof EmployeeProfileError) return reply(error.status, { error: error.message });
    context.error("Wage change request failed."); return reply(503, { error: "Unable to confirm the wage change. Reload its history before trying again." });
  }
}
app.http("wageChanges", { methods: ["GET", "POST"], authLevel: "anonymous", route: "wagechanges", handler: withReturnedRecordAudit("wageChanges", wageChanges) });
