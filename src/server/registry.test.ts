import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProject, getProject, listProjects, removeProject } from "./registry";

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "envis-cfg-"));
  process.env.ENVIS_CONFIG_DIR = configDir;
});

afterEach(async () => {
  delete process.env.ENVIS_CONFIG_DIR;
  await rm(configDir, { recursive: true, force: true });
});

describe("registro de proyectos", () => {
  it("añade un proyecto derivando el nombre del directorio", async () => {
    const p = await addProject("/tmp/mi-proyecto");
    expect(p.name).toBe("mi-proyecto");
    expect(p.dir).toBe("/tmp/mi-proyecto");
    expect(await listProjects()).toHaveLength(1);
  });

  it("no duplica el mismo directorio (idempotente)", async () => {
    const a = await addProject("/tmp/foo");
    const b = await addProject("/tmp/foo/");
    expect(b.id).toBe(a.id);
    expect(await listProjects()).toHaveLength(1);
  });

  it("recupera por id y elimina", async () => {
    const p = await addProject("/tmp/foo");
    expect((await getProject(p.id))?.id).toBe(p.id);
    await removeProject(p.id);
    expect(await listProjects()).toHaveLength(0);
  });
});
