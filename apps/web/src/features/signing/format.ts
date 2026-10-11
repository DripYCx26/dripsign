const UNITS = ["B", "KB", "MB", "GB"] as const;

/** "184 KB", "1.2 MB": evidence sizes for download cards. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit] ?? "B"}`;
}

/** The 12-character form of a sha256 shown beside evidence. */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}
