import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGroups, writeGroups } from "./groups";
import type { FileGroups } from "../core/groups";

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "envis-cfg-"));
  process.env.ENVIS_CONFIG_DIR = configDir;
});

afterEach(async () => {
  delete process.env.ENVIS_CONFIG_DIR;
  await rm(configDir, { recursive: true, force: true });
});

const sample: FileGroups = {
  groups: [{ id: "g1", name: "acceso" }],
  assignments: { USER: "g1", PASS: "g1" },
};
const empty: FileGroups = { groups: [], assignments: {} };

describe("persistencia de grupos", () => {
  it("devuelve vacío cuando no hay nada guardado", async () => {
    expect(await readGroups("p1", ".env")).toEqual(empty);
  });

  it("guarda y recupera la agrupación de un fichero (roundtrip)", async () => {
    await writeGroups("p1", ".env", sample);
    expect(await readGroups("p1", ".env")).toEqual(sample);
  });

  it("aísla por proyecto y por fichero", async () => {
    await writeGroups("p1", ".env", sample);
    expect(await readGroups("p2", ".env")).toEqual(empty);
    expect(await readGroups("p1", ".env.local")).toEqual(empty);
  });

  it("no pisa la agrupación de otros ficheros del mismo proyecto", async () => {
    const other: FileGroups = { groups: [{ id: "x", name: "otros" }], assignments: { Z: "x" } };
    await writeGroups("p1", ".env", sample);
    await writeGroups("p1", ".env.local", other);
    expect(await readGroups("p1", ".env")).toEqual(sample);
    expect(await readGroups("p1", ".env.local")).toEqual(other);
  });
});
