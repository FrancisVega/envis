export interface Project {
  id: string;
  name: string;
  dir: string;
}

export interface EnvFileInfo {
  name: string;
  isExample: boolean;
}

export interface Var {
  line: number;
  key: string;
  value: string;
  enabled: boolean;
  isExport: boolean;
  inlineComment: string | null;
}

export interface Diff {
  example: string | null;
  missing: string[];
  extra: string[];
}

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

export interface Comparison {
  a: string;
  b: string;
  onlyInA: string[];
  onlyInB: string[];
  different: { key: string; a: string; b: string }[];
  equal: string[];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const enc = encodeURIComponent;
const base = (pid: string, name: string) => `/api/projects/${pid}/files/${enc(name)}`;

export const api = {
  projects: () => req<Project[]>("/api/projects"),
  current: () => req<Project | null>("/api/current"),
  addProject: (dir: string) => req<Project>("/api/projects", send("POST", { dir })),
  removeProject: (id: string) => req(`/api/projects/${id}`, { method: "DELETE" }),
  browse: (path?: string) => req<BrowseResult>(`/api/browse${path ? `?path=${enc(path)}` : ""}`),

  files: (pid: string) => req<EnvFileInfo[]>(`/api/projects/${pid}/files`),
  vars: (pid: string, name: string) => req<{ name: string; vars: Var[] }>(base(pid, name)),
  diff: (pid: string, name: string) => req<Diff>(`${base(pid, name)}/diff`),
  toggle: (pid: string, name: string, line: number) =>
    req(`${base(pid, name)}/toggle`, send("POST", { line })),
  setValue: (pid: string, name: string, line: number, value: string) =>
    req(`${base(pid, name)}/value`, send("PUT", { line, value })),
  add: (pid: string, name: string, key: string, value: string) =>
    req(`${base(pid, name)}/vars`, send("POST", { key, value })),
  remove: (pid: string, name: string, line: number) =>
    req(`${base(pid, name)}/vars/${line}`, { method: "DELETE" }),

  activate: (pid: string, name: string) => req(`${base(pid, name)}/activate`, { method: "POST" }),
  createFile: (pid: string, name: string, from?: string) =>
    req<{ name: string }>(`/api/projects/${pid}/files`, send("POST", { name, from })),
  compare: (pid: string, a: string, b: string) =>
    req<Comparison>(`/api/projects/${pid}/compare?a=${enc(a)}&b=${enc(b)}`),
};
