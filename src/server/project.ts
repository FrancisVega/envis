/**
 * Acceso a los ficheros .env de un directorio de proyecto.
 * En la Fase 1 el "proyecto" es siempre el directorio actual (cwd).
 */

import { access, copyFile, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { EnvFile } from "../core/env-file";

const EXAMPLE_RE = /\.(example|sample|template|dist)$/;

export interface EnvFileInfo {
  name: string;
  /** Es una plantilla (.env.example y similares), no un fichero "real". */
  isExample: boolean;
}

/** Nombre de fichero seguro: un `.env*` del propio directorio, sin rutas. */
export function isValidEnvName(name: string): boolean {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

export async function listEnvFiles(dir: string): Promise<EnvFileInfo[]> {
  const all = await readdir(dir);
  return all
    .filter((f) => f === ".env" || f.startsWith(".env."))
    .sort()
    .map((name) => ({ name, isExample: EXAMPLE_RE.test(name) }));
}

export async function readEnvFile(dir: string, name: string): Promise<EnvFile> {
  return EnvFile.parse(await readFile(join(dir, name), "utf8"));
}

export async function writeEnvFile(dir: string, name: string, env: EnvFile): Promise<void> {
  await writeFile(join(dir, name), env.serialize(), "utf8");
}

export async function fileExists(dir: string, name: string): Promise<boolean> {
  try {
    await access(join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/** Vuelca un perfil sobre `.env`, guardando antes `.env.bak` si `.env` existía. */
export async function activateProfile(dir: string, name: string): Promise<{ backedUp: boolean }> {
  const target = join(dir, ".env");
  const backedUp = await fileExists(dir, ".env");
  if (backedUp) await copyFile(target, join(dir, ".env.bak"));
  await copyFile(join(dir, name), target);
  return { backedUp };
}

/** Crea un perfil nuevo: vacío, o duplicando el contenido de `from`. */
export async function createProfile(dir: string, name: string, from?: string): Promise<void> {
  if (await fileExists(dir, name)) throw new Error("ya existe un fichero con ese nombre");
  if (from) await copyFile(join(dir, from), join(dir, name));
  else await writeFile(join(dir, name), "", "utf8");
}
