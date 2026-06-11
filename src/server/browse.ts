/**
 * Explorador de carpetas para elegir la ruta de un proyecto desde la UI.
 * Devuelve los subdirectorios de un path (ocultos excluidos) y el padre para
 * poder navegar hacia arriba. Si no se pasa path, arranca en el home.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface BrowseEntry {
  name: string;
  path: string;
  hasEnv: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export async function browse(input?: string): Promise<BrowseResult> {
  const path = input && input.trim() !== "" ? resolve(input) : homedir();
  const names = await readdir(path);

  const entries: BrowseEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(path, name);
    try {
      if (!(await stat(full)).isDirectory()) continue;
      entries.push({ name, path: full, hasEnv: await hasEnvFile(full) });
    } catch {
      // Carpeta inaccesible (permisos, etc.): la omitimos.
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, entries };
}

async function hasEnvFile(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).some((f) => f === ".env" || f.startsWith(".env."));
  } catch {
    return false;
  }
}
