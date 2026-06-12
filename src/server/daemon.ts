/**
 * Daemon en background: un único proceso envis sirve TODOS los proyectos del
 * registro (el server ya es multi-proyecto). El estado vive en
 * `~/.config/envis/daemon.json` (override con `ENVIS_CONFIG_DIR`); el cliente lo
 * detecta por health-check HTTP y, si no responde, lo arranca *detached* —
 * dejando el terminal libre al instante.
 */

import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config-dir";

export interface DaemonState {
  pid: number;
  port: number;
  startedAt: string;
}

const DEFAULT_PORT = 5180;

/** Puerto del daemon: `ENVIS_PORT` si es un puerto válido, o 5180 por defecto. */
export function daemonPort(): number {
  const n = Number(process.env.ENVIS_PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function stateFile(): string {
  return join(configDir(), "daemon.json");
}

/** Log del daemon (su stdout/stderr van aquí al arrancarlo detached). */
export function logFile(): string {
  return join(configDir(), "daemon.log");
}

export function readState(): DaemonState | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(), "utf8")) as DaemonState;
    return typeof s?.pid === "number" && typeof s?.port === "number" ? s : null;
  } catch {
    return null;
  }
}

export function writeState(state: DaemonState): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function clearState(): void {
  try {
    unlinkSync(stateFile());
  } catch {
    /* no existía: nada que limpiar */
  }
}

/** Health-check: ¿hay un envis escuchando y respondiendo en ese puerto? */
export async function pingDaemon(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/meta`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Garantiza que el daemon está corriendo y devuelve su puerto. Si ya responde,
 * no hace nada (`started: false`); si no, lo arranca *detached*
 * (`node cli.js --daemon`) y espera a que responda. `cliPath` es la ruta del
 * propio `cli.js`, que pasa `cli.ts` (`fileURLToPath(import.meta.url)`).
 */
export async function ensureDaemon(cliPath: string): Promise<{ port: number; started: boolean }> {
  const port = daemonPort();
  if (await pingDaemon(port)) return { port, started: false };

  mkdirSync(configDir(), { recursive: true });
  const out = openSync(logFile(), "a");
  const child = spawn(process.execPath, [cliPath, "--daemon"], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(120);
    if (await pingDaemon(port)) return { port, started: true };
  }
  throw new Error(
    `el daemon no respondió en el puerto ${port}. Revisa ${logFile()} ` +
      `(¿puerto ocupado? prueba con otro ENVIS_PORT).`,
  );
}

/** Para el daemon (SIGTERM) y limpia el estado. */
export async function stopDaemon(): Promise<{ stopped: boolean; port?: number }> {
  const state = readState();
  if (!state) return { stopped: false };
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    /* el proceso ya no existía; limpiamos el estado igualmente */
  }
  clearState();
  return { stopped: true, port: state.port };
}

/** Estado actual confirmado por health-check: ¿corre?, en qué puerto/URL. */
export async function daemonStatus(): Promise<{ running: boolean; port: number; url?: string }> {
  const port = readState()?.port ?? daemonPort();
  if (await pingDaemon(port)) return { running: true, port, url: `http://127.0.0.1:${port}` };
  return { running: false, port };
}
