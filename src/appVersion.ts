/**
 * Comparison for the launch-time version gate (GET /meta/min-app-version).
 *
 * Versions are semver ("1.2.3", optionally "-beta.1"). The installed build's
 * version comes from the native binary (versionName / CFBundleShortVersionString),
 * which scripts/check-config.mjs keeps equal to package.json's version.
 */

type Parsed = { core: [number, number, number]; prerelease: string | null };

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): Parsed | null {
  const m = SEMVER.exec(version.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ?? null,
  };
}

function comparePrerelease(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (!Number.isNaN(na)) {
      return -1; // numeric identifiers sort before alphanumeric ones
    } else if (!Number.isNaN(nb)) {
      return 1;
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Negative if a < b, 0 if equal, positive if a > b (semver precedence). */
export function compareVersions(a: Parsed, b: Parsed): number {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1; // 1.0.0 > 1.0.0-beta
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * True when this build must be updated before it can be used.
 *
 * An installed version that can't be parsed is treated as too old: the gate exists
 * to stop unsupported builds, so it fails closed. A minimum the server sends that
 * can't be parsed is a server misconfiguration and does not lock every user out.
 */
export function isUpdateRequired(installed: string, minimum: string): boolean {
  const min = parseVersion(minimum);
  if (!min) return false;
  const current = parseVersion(installed);
  if (!current) return true;
  return compareVersions(current, min) < 0;
}
