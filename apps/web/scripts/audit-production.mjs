import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const allowlistPath = new URL("../audit-allowlist.json", import.meta.url);
const configuredAdvisories =
  JSON.parse(readFileSync(allowlistPath, "utf8")).advisories ?? {};
const allowlist = Object.fromEntries(
  Object.entries(configuredAdvisories).map(([advisoryId, entry]) => [
    advisoryId.toUpperCase(),
    entry,
  ]),
);
const today = new Date().toISOString().slice(0, 10);

for (const [advisoryId, entry] of Object.entries(allowlist)) {
  if (!entry.reason || !entry.expiresOn || !Array.isArray(entry.packages)) {
    throw new Error(`Invalid audit allowlist entry: ${advisoryId}`);
  }
  if (entry.expiresOn < today) {
    throw new Error(`Expired audit allowlist entry: ${advisoryId} (${entry.expiresOn})`);
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const auditResult = spawnSync(npmCommand, ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
});

if (auditResult.error) throw auditResult.error;

let report;
try {
  report = JSON.parse(auditResult.stdout);
} catch {
  process.stderr.write(auditResult.stderr || auditResult.stdout);
  throw new Error("npm audit did not return valid JSON");
}

if (report.error || !report.vulnerabilities) {
  process.stderr.write(JSON.stringify(report, null, 2));
  throw new Error("npm audit failed before producing a vulnerability report");
}

const advisoryIdFromUrl = (url) =>
  /\/advisories\/(GHSA-[a-z0-9-]+)/i.exec(url ?? "")?.[1]?.toUpperCase() ?? null;

const allowedAdvisories = new Set();
const blockingMemo = new Map();

function hasBlockingAdvisory(packageName, visiting = new Set()) {
  if (blockingMemo.has(packageName)) return blockingMemo.get(packageName);
  if (visiting.has(packageName)) return false;

  const vulnerability = report.vulnerabilities[packageName];
  if (!vulnerability) return false;

  const nextVisiting = new Set(visiting).add(packageName);
  const blocking = vulnerability.via.some((cause) => {
    if (typeof cause === "string") {
      return hasBlockingAdvisory(cause, nextVisiting);
    }

    if ((severityRank[cause.severity] ?? 0) < severityRank.high) return false;

    const advisoryId = advisoryIdFromUrl(cause.url);
    const exception = advisoryId ? allowlist[advisoryId] : null;
    const isAllowed =
      exception?.packages.includes(packageName) && exception.expiresOn >= today;

    if (isAllowed) {
      allowedAdvisories.add(advisoryId);
      return false;
    }
    return true;
  });

  blockingMemo.set(packageName, blocking);
  return blocking;
}

const blockingPackages = Object.entries(report.vulnerabilities)
  .filter(([, vulnerability]) =>
    (severityRank[vulnerability.severity] ?? 0) >= severityRank.high,
  )
  .filter(([packageName]) => hasBlockingAdvisory(packageName))
  .map(([packageName]) => packageName);

if (blockingPackages.length > 0) {
  process.stderr.write(
    `Unapproved high/critical production vulnerabilities: ${blockingPackages.join(", ")}\n`,
  );
  process.stderr.write(auditResult.stdout);
  process.exit(1);
}

const unusedAllowlistEntries = Object.keys(allowlist).filter(
  (advisoryId) => !allowedAdvisories.has(advisoryId),
);
if (unusedAllowlistEntries.length > 0) {
  throw new Error(
    `Unused audit allowlist entries must be removed: ${unusedAllowlistEntries.join(", ")}`,
  );
}

for (const advisoryId of allowedAdvisories) {
  const exception = allowlist[advisoryId];
  process.stdout.write(
    `Allowed ${advisoryId} until ${exception.expiresOn}: ${exception.reason}\n`,
  );
}

process.stdout.write("No unapproved high/critical production vulnerabilities found.\n");
