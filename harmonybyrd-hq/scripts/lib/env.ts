import { existsSync } from "node:fs";
import path from "node:path";

/** Load .env.local then .env from the project root (first value wins, real env wins over both). */
export function loadEnv(): void {
  const root = projectRoot();
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        /* unreadable env file: fall through to real environment */
      }
    }
  }
}

export function projectRoot(): string {
  return path.resolve(import.meta.dirname, "..", "..");
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local (or run "npm run setup") and try again.`,
    );
  }
  return value;
}
