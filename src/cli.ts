#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { createApp, type AppOptions } from "./server/app";
import { addProject } from "./server/registry";
import { listEnvFiles } from "./server/project";
import { clearState, daemonPort, daemonStatus, ensureDaemon, stopDaemon, writeState } from "./server/daemon";

const cliPath = fileURLToPath(import.meta.url);
const webDir = join(dirname(cliPath), "web");
const indexHtml = readFileSync(join(webDir, "index.html"), "utf8");
const noOpen = process.env.ENVIS_NO_OPEN === "1";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function buildApp(opts: AppOptions): Hono {
  const app = new Hono();
  app.route("/", createApp(opts));
  app.get("/*", (c) => c.html(indexHtml));
  return app;
}

// Modo aislado: server efímero en foreground, sin daemon ni registro (como antes).
function runIsolated(): void {
  const dir = process.cwd();
  const app = buildApp({ currentDir: dir, isolated: true });
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    const url = `http://127.0.0.1:${info.port}`;
    console.log(`\n  ${green("▍envis")}  ${dir} ${dim("(aislado)")}`);
    console.log(`  ${dim(url)}\n`);
    if (!noOpen) void open(url).catch(() => {});
  });
}

// Modo daemon: proceso persistente que sirve todo el registro. Lo arranca el
// cliente de forma detached; es neutral (sin currentDir: cada cliente registra
// su propio cwd y abre el navegador apuntando a él vía `?project`).
function runDaemon(): void {
  const port = daemonPort();
  const server = serve({ fetch: buildApp({}).fetch, hostname: "127.0.0.1", port }, () => {
    writeState({ pid: process.pid, port, startedAt: new Date().toISOString() });
    console.log(`envis daemon ▸ http://127.0.0.1:${port} (pid ${process.pid})`);
  });
  server.on("error", (err: Error) => {
    console.error(`no se pudo arrancar el daemon en el puerto ${port}: ${err.message}`);
    process.exit(1);
  });
  const shutdown = () => {
    clearState();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Modo cliente (por defecto): registra el cwd, asegura el daemon y abre el
// navegador en ese proyecto. Devuelve el prompt sin bloquear el terminal.
// El cwd solo se registra si tiene ficheros .env; si no, envis se abre en modo
// global (sin añadir este directorio) para gestionar el resto del registro.
async function runClient(): Promise<void> {
  const dir = process.cwd();
  const hasEnv = (await listEnvFiles(dir)).length > 0;
  const project = hasEnv ? await addProject(dir) : null;
  try {
    const { port, started } = await ensureDaemon(cliPath);
    const base = `http://127.0.0.1:${port}/`;
    const url = project ? `${base}?project=${project.id}` : base;
    const note = dim(started ? "(daemon arrancado)" : "(daemon activo)");
    const label = project ? project.dir : `${dir} ${dim("(sin .env, no registrado)")}`;
    console.log(`\n  ${green("▍envis")}  ${label}`);
    console.log(`  ${dim(url)} ${note}\n`);
    if (!noOpen) void open(url).catch(() => {});
  } catch (e) {
    console.error(`\n  ${(e as Error).message}\n`);
    process.exit(1);
  }
}

async function runStop(): Promise<void> {
  const { stopped, port } = await stopDaemon();
  console.log(stopped ? `envis daemon detenido (puerto ${port}).` : "no había ningún daemon en marcha.");
}

async function runStatus(): Promise<void> {
  const s = await daemonStatus();
  console.log(s.running ? `envis daemon activo ▸ ${s.url}` : "envis daemon detenido.");
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "stop") void runStop();
else if (cmd === "status") void runStatus();
else if (args.includes("--daemon")) runDaemon();
else if (args.includes("--isolated")) runIsolated();
else void runClient();
