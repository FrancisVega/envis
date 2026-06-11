#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { createApp } from "./server/app";
import { addProject } from "./server/registry";

const projectDir = process.cwd();
const isolated = process.argv.slice(2).includes("--isolated");
const webDir = join(dirname(fileURLToPath(import.meta.url)), "web");
const indexHtml = readFileSync(join(webDir, "index.html"), "utf8");

const app = new Hono();
app.route("/", createApp({ currentDir: projectDir, isolated }));
app.get("/*", (c) => c.html(indexHtml));

async function start() {
  // Ejecutar envis en un directorio lo registra como proyecto (idempotente).
  // En modo aislado no se toca el registro global.
  if (!isolated) await addProject(projectDir);

  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    const url = `http://127.0.0.1:${info.port}`;
    const tag = isolated ? " \x1b[2m(aislado)\x1b[0m" : "";
    console.log(`\n  \x1b[32m▍envis\x1b[0m  ${projectDir}${tag}`);
    console.log(`  \x1b[2m${url}\x1b[0m\n`);
    if (process.env.ENVIS_NO_OPEN !== "1") void open(url).catch(() => {});
  });
}

void start();
