import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const productionSecret =
  "production-secret-that-is-at-least-thirty-two-characters";

describe("runtime configuration", () => {
  it("accepts PostgreSQL connection strings", () => {
    expect(
      loadConfig({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/shared_deposit",
      }).DATABASE_URL,
    ).toBe("postgresql://user:pass@localhost:5432/shared_deposit");
    expect(
      loadConfig({
        DATABASE_URL: "postgres://user:pass@localhost:5432/shared_deposit",
      }).DATABASE_URL,
    ).toBe("postgres://user:pass@localhost:5432/shared_deposit");
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "https://database.example.com/shared_deposit",
      }),
    ).toThrow(/postgres:\/\/ or postgresql:\/\//);
  });

  it("requires a database in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        JWT_SECRET: productionSecret,
      }),
    ).toThrow("DATABASE_URL must be set in production.");
  });

  it("requires a non-default JWT secret in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://user:pass@localhost:5432/shared_deposit",
      }),
    ).toThrow("JWT_SECRET must be set in production.");
  });
});
