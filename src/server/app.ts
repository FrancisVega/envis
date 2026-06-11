/**
 * API HTTP (Hono) multi-proyecto. Los proyectos viven en el registro
 * (`registry.ts`); las operaciones sobre ficheros .env se hacen siempre dentro
 * del directorio de un proyecto, identificado por `:id` en la ruta.
 * Servir el frontend estático es responsabilidad del arranque (cli.ts).
 */

import { stat } from "node:fs/promises";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { EnvFile, compareEnvFiles, diffWithExample, type EnvVar } from "../core/env-file";
import {
  activateProfile,
  createProfile,
  isValidEnvName,
  listEnvFiles,
  readEnvFile,
  writeEnvFile,
} from "./project";
import { addProject, getProject, listProjects, removeProject } from "./registry";
import { browse } from "./browse";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface VarDto {
  line: number;
  key: string;
  value: string;
  enabled: boolean;
  isExport: boolean;
  inlineComment: string | null;
}

function toDto(env: EnvFile): VarDto[] {
  return env.vars.map((v: EnvVar) => ({
    line: v.line,
    key: v.key,
    value: v.value,
    enabled: v.enabled,
    isExport: v.isExport,
    inlineComment: v.inlineComment,
  }));
}

class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}

async function requireProjectDir(c: Context): Promise<string> {
  const project = await getProject(c.req.param("id") ?? "");
  if (!project) throw new HttpError(404, "proyecto no encontrado");
  return project.dir;
}

function requireName(c: Context): string {
  const name = c.req.param("name");
  if (!name || !isValidEnvName(name)) throw new HttpError(400, "nombre de fichero .env inválido");
  return name;
}

export interface AppOptions {
  /** Directorio desde el que se lanzó envis; se auto-registra y queda activo. */
  currentDir?: string;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // --- Proyectos -----------------------------------------------------------
  app.get("/api/projects", async (c) => c.json(await listProjects()));

  app.get("/api/current", async (c) => {
    if (!options.currentDir) return c.json(null);
    return c.json(await addProject(options.currentDir));
  });

  app.post("/api/projects", async (c) => {
    const { dir } = await c.req.json<{ dir?: string }>();
    if (typeof dir !== "string" || dir.trim() === "") throw new HttpError(400, "falta 'dir'");
    const ok = await stat(dir).then((s) => s.isDirectory(), () => false);
    if (!ok) throw new HttpError(400, "el directorio no existe");
    return c.json(await addProject(dir), 201);
  });

  app.delete("/api/projects/:id", async (c) => {
    await removeProject(c.req.param("id"));
    return c.json({ ok: true });
  });

  // --- Explorador de carpetas ---------------------------------------------
  app.get("/api/browse", async (c) => c.json(await browse(c.req.query("path"))));

  // --- Ficheros .env de un proyecto ---------------------------------------
  app.get("/api/projects/:id/files", async (c) =>
    c.json(await listEnvFiles(await requireProjectDir(c))),
  );

  // Crear / duplicar un perfil.
  app.post("/api/projects/:id/files", async (c) => {
    const dir = await requireProjectDir(c);
    const { name, from } = await c.req.json<{ name?: string; from?: string }>();
    if (!name || !isValidEnvName(name)) throw new HttpError(400, "nombre de fichero .env inválido");
    if (from && !isValidEnvName(from)) throw new HttpError(400, "perfil de origen inválido");
    await createProfile(dir, name, from);
    return c.json({ name }, 201);
  });

  // Comparar dos perfiles (valores activos): qué claves difieren, faltan o sobran.
  app.get("/api/projects/:id/compare", async (c) => {
    const dir = await requireProjectDir(c);
    const a = c.req.query("a");
    const b = c.req.query("b");
    if (!a || !isValidEnvName(a) || !b || !isValidEnvName(b)) {
      throw new HttpError(400, "perfiles a comparar inválidos");
    }
    const [ea, eb] = await Promise.all([readEnvFile(dir, a), readEnvFile(dir, b)]);
    return c.json({ a, b, ...compareEnvFiles(ea, eb) });
  });

  // Activar un perfil: volcarlo a `.env` (con backup `.env.bak`).
  app.post("/api/projects/:id/files/:name/activate", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    if (name === ".env") throw new HttpError(400, "ese fichero ya es el .env activo");
    const { backedUp } = await activateProfile(dir, name);
    return c.json({ activated: name, backedUp });
  });

  app.get("/api/projects/:id/files/:name", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    return c.json({ name, vars: toDto(await readEnvFile(dir, name)) });
  });

  app.get("/api/projects/:id/files/:name/diff", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    const env = await readEnvFile(dir, name);
    const exampleName = (await listEnvFiles(dir)).find((f) => f.isExample)?.name;
    if (!exampleName) return c.json({ example: null, missing: [], extra: [] });
    const example = await readEnvFile(dir, exampleName);
    return c.json({ example: exampleName, ...diffWithExample(env, example) });
  });

  app.post("/api/projects/:id/files/:name/toggle", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    const { line } = await c.req.json<{ line?: number }>();
    if (typeof line !== "number") throw new HttpError(400, "falta 'line'");
    const env = await readEnvFile(dir, name);
    const enabled = env.toggle(line);
    await writeEnvFile(dir, name, env);
    return c.json({ line, enabled });
  });

  app.put("/api/projects/:id/files/:name/value", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    const { line, value } = await c.req.json<{ line?: number; value?: string }>();
    if (typeof line !== "number") throw new HttpError(400, "falta 'line'");
    if (typeof value !== "string") throw new HttpError(400, "falta 'value'");
    const env = await readEnvFile(dir, name);
    env.setValue(line, value);
    await writeEnvFile(dir, name, env);
    return c.json({ line, value });
  });

  app.post("/api/projects/:id/files/:name/vars", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    const { key, value, enabled } = await c.req.json<{
      key?: string;
      value?: string;
      enabled?: boolean;
    }>();
    if (typeof key !== "string" || !KEY_RE.test(key)) throw new HttpError(400, "clave inválida");
    const env = await readEnvFile(dir, name);
    const added = env.add(key, value ?? "", { enabled });
    await writeEnvFile(dir, name, env);
    return c.json({ line: added.line, key: added.key }, 201);
  });

  app.delete("/api/projects/:id/files/:name/vars/:line", async (c) => {
    const dir = await requireProjectDir(c);
    const name = requireName(c);
    const line = Number(c.req.param("line"));
    if (!Number.isInteger(line)) throw new HttpError(400, "línea inválida");
    const env = await readEnvFile(dir, name);
    env.remove(line);
    await writeEnvFile(dir, name, env);
    return c.json({ line });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "fichero no encontrado" }, 404);
    }
    return c.json({ error: err.message }, 400);
  });

  return app;
}
