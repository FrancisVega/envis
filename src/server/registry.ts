/**
 * Registro persistente de proyectos en `~/.config/envis/projects.json`
 * (override con `ENVIS_CONFIG_DIR`, útil en tests). Cada proyecto es un
 * directorio del sistema con sus ficheros .env.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface Project {
  id: string;
  name: string;
  dir: string;
}

function configDir(): string {
  return process.env.ENVIS_CONFIG_DIR ?? join(homedir(), ".config", "envis");
}

function configFile(): string {
  return join(configDir(), "projects.json");
}

async function load(): Promise<Project[]> {
  try {
    const data: unknown = JSON.parse(await readFile(configFile(), "utf8"));
    return Array.isArray(data) ? (data as Project[]) : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function save(projects: Project[]): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configFile(), JSON.stringify(projects, null, 2) + "\n", "utf8");
}

export async function listProjects(): Promise<Project[]> {
  return load();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await load()).find((p) => p.id === id);
}

/** Añade un proyecto por su directorio. Idempotente: si ya existe, lo devuelve. */
export async function addProject(dir: string): Promise<Project> {
  const resolved = resolve(dir);
  const projects = await load();
  const existing = projects.find((p) => p.dir === resolved);
  if (existing) return existing;
  const project: Project = { id: randomUUID(), name: basename(resolved), dir: resolved };
  projects.push(project);
  await save(projects);
  return project;
}

/** Quita un proyecto del registro (no borra nada del disco). */
export async function removeProject(id: string): Promise<void> {
  const projects = await load();
  const next = projects.filter((p) => p.id !== id);
  if (next.length !== projects.length) await save(next);
}
