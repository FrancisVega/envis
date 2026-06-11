import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { addProject } from "./registry";

let dir: string;
let configDir: string;
let app: ReturnType<typeof createApp>;
let id: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "envis-proj-"));
  configDir = await mkdtemp(join(tmpdir(), "envis-cfg-"));
  process.env.ENVIS_CONFIG_DIR = configDir;
  await writeFile(join(dir, ".env"), "DEBUG=true\nPORT=3000\n");
  await writeFile(join(dir, ".env.example"), "DEBUG=\nPORT=\nSECRET=\n");
  id = (await addProject(dir)).id;
  app = createApp();
});

afterEach(async () => {
  delete process.env.ENVIS_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("proyectos", () => {
  it("lista los proyectos registrados", async () => {
    const res = await app.request("/api/projects");
    const body = (await res.json()) as { id: string }[];
    expect(body.map((p) => p.id)).toContain(id);
  });

  it("añade un proyecto por ruta y rechaza rutas inexistentes", async () => {
    const ok = await app.request("/api/projects", json({ dir }));
    expect(ok.status).toBe(201);
    const bad = await app.request("/api/projects", json({ dir: "/no/existe/seguro" }));
    expect(bad.status).toBe(400);
  });

  it("elimina un proyecto del registro", async () => {
    const res = await app.request(`/api/projects/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const list = (await (await app.request("/api/projects")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("devuelve 404 al operar sobre un proyecto inexistente", async () => {
    const res = await app.request("/api/projects/inexistente/files");
    expect(res.status).toBe(404);
  });

  it("expone metadatos de sesión (no aislado por defecto)", async () => {
    const meta = (await (await app.request("/api/meta")).json()) as { isolated: boolean };
    expect(meta.isolated).toBe(false);
  });
});

describe("ficheros .env de un proyecto", () => {
  it("lista los ficheros marcando los de ejemplo", async () => {
    const res = await app.request(`/api/projects/${id}/files`);
    const files = (await res.json()) as { name: string; isExample: boolean }[];
    expect(files.map((f) => f.name)).toEqual([".env", ".env.example"]);
    expect(files.find((f) => f.name === ".env.example")!.isExample).toBe(true);
  });

  it("devuelve las variables de un fichero", async () => {
    const res = await app.request(`/api/projects/${id}/files/.env`);
    const body = (await res.json()) as { vars: { key: string }[] };
    expect(body.vars.map((v) => v.key)).toEqual(["DEBUG", "PORT"]);
  });

  it("togglea una variable y la persiste en disco", async () => {
    const res = await app.request(`/api/projects/${id}/files/.env/toggle`, json({ line: 0 }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { enabled: boolean }).enabled).toBe(false);
    expect(await readFile(join(dir, ".env"), "utf8")).toContain("# DEBUG=true");
  });

  it("edita el valor de una variable", async () => {
    const res = await app.request(`/api/projects/${id}/files/.env/value`, {
      ...json({ line: 1, value: "8080" }),
      method: "PUT",
    });
    expect(res.status).toBe(200);
    expect(await readFile(join(dir, ".env"), "utf8")).toContain("PORT=8080");
  });

  it("añade y elimina variables", async () => {
    const add = await app.request(`/api/projects/${id}/files/.env/vars`, json({ key: "API_KEY", value: "xyz" }));
    expect(add.status).toBe(201);
    expect(await readFile(join(dir, ".env"), "utf8")).toContain("API_KEY=xyz");
    const { line } = (await add.json()) as { line: number };
    const del = await app.request(`/api/projects/${id}/files/.env/vars/${line}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await readFile(join(dir, ".env"), "utf8")).not.toContain("API_KEY");
  });

  it("compara con .env.example", async () => {
    const res = await app.request(`/api/projects/${id}/files/.env/diff`);
    const body = (await res.json()) as { missing: string[]; extra: string[] };
    expect(body.missing).toEqual(["SECRET"]);
    expect(body.extra).toEqual([]);
  });

  it("rechaza nombres con path traversal", async () => {
    const res = await app.request(`/api/projects/${id}/files/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });
});

describe("explorador de carpetas", () => {
  it("lista subdirectorios de una ruta", async () => {
    await writeFile(join(dir, ".env.local"), "X=1\n");
    const res = await app.request(`/api/browse?path=${encodeURIComponent(dir)}`);
    const body = (await res.json()) as { path: string; entries: unknown[] };
    expect(body.path).toBe(dir);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe("perfiles", () => {
  it("activa un perfil volcándolo a .env con backup", async () => {
    await writeFile(join(dir, ".env.production"), "DEBUG=false\nPORT=80\n");
    const res = await app.request(`/api/projects/${id}/files/.env.production/activate`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { backedUp: boolean }).backedUp).toBe(true);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("DEBUG=false\nPORT=80\n");
    expect(await readFile(join(dir, ".env.bak"), "utf8")).toContain("DEBUG=true");
  });

  it("crea un perfil nuevo y rechaza duplicados", async () => {
    const ok = await app.request(`/api/projects/${id}/files`, json({ name: ".env.staging" }));
    expect(ok.status).toBe(201);
    expect(await readFile(join(dir, ".env.staging"), "utf8")).toBe("");
    const dup = await app.request(`/api/projects/${id}/files`, json({ name: ".env.staging" }));
    expect(dup.status).toBe(400);
  });

  it("duplica un perfil desde otro", async () => {
    const res = await app.request(
      `/api/projects/${id}/files`,
      json({ name: ".env.copy", from: ".env" }),
    );
    expect(res.status).toBe(201);
    expect(await readFile(join(dir, ".env.copy"), "utf8")).toBe("DEBUG=true\nPORT=3000\n");
  });

  it("compara dos perfiles", async () => {
    await writeFile(join(dir, ".env.production"), "DEBUG=false\nPORT=3000\nEXTRA=1\n");
    const res = await app.request(`/api/projects/${id}/compare?a=.env&b=.env.production`);
    const r = (await res.json()) as {
      onlyInB: string[];
      different: { key: string }[];
      equal: string[];
    };
    expect(r.onlyInB).toEqual(["EXTRA"]);
    expect(r.different.map((d) => d.key)).toEqual(["DEBUG"]);
    expect(r.equal).toEqual(["PORT"]);
  });
});

describe("modo aislado (--isolated)", () => {
  let iso: ReturnType<typeof createApp>;

  beforeEach(() => {
    iso = createApp({ currentDir: dir, isolated: true });
  });

  it("expone solo el directorio actual como único proyecto", async () => {
    const list = (await (await iso.request("/api/projects")).json()) as { dir: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].dir).toBe(dir);
  });

  it("/api/meta indica que está aislado", async () => {
    const meta = (await (await iso.request("/api/meta")).json()) as { isolated: boolean };
    expect(meta.isolated).toBe(true);
  });

  it("opera sobre los ficheros del proyecto aislado por su id", async () => {
    const cur = (await (await iso.request("/api/current")).json()) as { id: string };
    const res = await iso.request(`/api/projects/${cur.id}/files`);
    expect(res.status).toBe(200);
    const files = (await res.json()) as { name: string }[];
    expect(files.map((f) => f.name)).toContain(".env");
  });

  it("no permite añadir ni quitar proyectos", async () => {
    const add = await iso.request("/api/projects", json({ dir }));
    expect(add.status).toBe(403);
    const del = await iso.request("/api/projects/isolated", { method: "DELETE" });
    expect(del.status).toBe(403);
  });
});
