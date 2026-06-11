/**
 * Persistencia de la agrupación de variables (solo presentación, ver
 * `core/groups.ts`). Vive aparte del .env, en el registro
 * (`~/.config/envis/groups.json`, override con `ENVIS_CONFIG_DIR`), indexada por
 * proyecto y por fichero. El .env nunca se toca.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileGroups } from "../core/groups";
import { configDir } from "./config-dir";

/** `{ [projectId]: { [fileName]: FileGroups } }` */
type GroupsStore = Record<string, Record<string, FileGroups>>;

function groupsFile(): string {
  return join(configDir(), "groups.json");
}

async function load(): Promise<GroupsStore> {
  try {
    const data: unknown = JSON.parse(await readFile(groupsFile(), "utf8"));
    return data && typeof data === "object" ? (data as GroupsStore) : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function save(store: GroupsStore): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(groupsFile(), JSON.stringify(store, null, 2) + "\n", "utf8");
}

/** Lee la agrupación de un fichero; vacía si no hay nada guardado. */
export async function readGroups(projectId: string, file: string): Promise<FileGroups> {
  return (await load())[projectId]?.[file] ?? { groups: [], assignments: {} };
}

/** Reemplaza por completo la agrupación de un fichero. */
export async function writeGroups(
  projectId: string,
  file: string,
  groups: FileGroups,
): Promise<void> {
  const store = await load();
  (store[projectId] ??= {})[file] = groups;
  await save(store);
}
