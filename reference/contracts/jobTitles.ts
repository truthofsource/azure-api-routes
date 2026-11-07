/** Printed/employment titles only. These values never grant application roles. */
export const jobTitles = ["Caregiver / Direct Support Professional", "Supervisor", "Administrator"] as const;
export type JobTitle = typeof jobTitles[number];
const aliases: Record<string, JobTitle> = {
  caregiver: jobTitles[0], "direct support professional": jobTitles[0], dsp: jobTitles[0],
  "caregiver / direct support professional": jobTitles[0], supervisor: jobTitles[1],
  admin: jobTitles[2], administrator: jobTitles[2],
};
export function normalizeJobTitle(value: unknown): JobTitle | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : null;
}
/** Retain unrecognized historical text rather than inventing a replacement. */
export function displayJobTitle(value: unknown): string {
  return normalizeJobTitle(value) ?? (typeof value === "string" ? value.trim() : "");
}
export function requireJobTitle(value: unknown): JobTitle {
  const title = normalizeJobTitle(value);
  if (!title) throw new Error("Choose Caregiver / Direct Support Professional, Supervisor or Administrator.");
  return title;
}
