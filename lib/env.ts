export function env(name: string): string {
  return process.env[name] ?? "";
}

export function allowedUserIds(): Set<string> {
  return new Set(
    env("ALLOWED_LINE_USER_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
