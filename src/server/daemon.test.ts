import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { clearState, daemonPort, pingDaemon, readState, writeState } from "./daemon";

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "envis-cfg-"));
  process.env.ENVIS_CONFIG_DIR = configDir;
});

afterEach(async () => {
  delete process.env.ENVIS_CONFIG_DIR;
  delete process.env.ENVIS_PORT;
  await rm(configDir, { recursive: true, force: true });
});

describe("estado del daemon", () => {
  it("roundtrip read/write/clear", () => {
    expect(readState()).toBeNull();
    const state = { pid: 123, port: 5180, startedAt: "2026-01-01T00:00:00.000Z" };
    writeState(state);
    expect(readState()).toEqual(state);
    clearState();
    expect(readState()).toBeNull();
  });

  it("clear es idempotente si no hay estado", () => {
    expect(() => clearState()).not.toThrow();
  });
});

describe("daemonPort", () => {
  it("usa 5180 por defecto", () => {
    expect(daemonPort()).toBe(5180);
  });

  it("respeta un ENVIS_PORT válido y descarta los inválidos", () => {
    process.env.ENVIS_PORT = "6000";
    expect(daemonPort()).toBe(6000);
    process.env.ENVIS_PORT = "no-numero";
    expect(daemonPort()).toBe(5180);
  });
});

describe("pingDaemon", () => {
  it("true mientras un envis escucha; false cuando se cierra", async () => {
    const { port, close } = await new Promise<{ port: number; close: () => Promise<void> }>(
      (resolve) => {
        const srv = serve({ fetch: createApp().fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
          resolve({ port: info.port, close: () => new Promise((r) => srv.close(() => r())) }),
        );
      },
    );

    try {
      expect(await pingDaemon(port)).toBe(true);
    } finally {
      await close();
    }
    expect(await pingDaemon(port)).toBe(false);
  });
});
