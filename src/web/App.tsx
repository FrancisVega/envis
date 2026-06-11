import { useCallback, useEffect, useState } from "react";
import {
  api,
  type BrowseResult,
  type Comparison,
  type Diff,
  type EnvFileInfo,
  type Project,
  type Var,
} from "./api";
import { groupVars, type FileGroups, type Group } from "../core/groups";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const msg = (e: unknown) => String((e as Error)?.message ?? e);

// Qué grupos están colapsados es estado de UI puro (no va al .env ni al
// registro): vive en localStorage. Los ids de grupo son UUID globales, así que
// un único conjunto sirve para todos los proyectos/ficheros sin colisiones.
const COLLAPSE_KEY = "envis:collapsed";
const loadCollapsed = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};
const saveCollapsed = (s: Set<string>) => localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]));

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<EnvFileInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [vars, setVars] = useState<Var[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [newProfile, setNewProfile] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [groups, setGroups] = useState<FileGroups>({ groups: [], assignments: {} });
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  useEffect(() => {
    (async () => {
      try {
        const [list, current, meta] = await Promise.all([
          api.projects(),
          api.current(),
          api.meta(),
        ]);
        setProjects(list);
        setActiveProject(current ?? list[0] ?? null);
        setIsolated(meta.isolated);
      } catch (e) {
        setError(msg(e));
      }
    })();
  }, []);

  const loadFiles = useCallback(async (pid: string) => {
    const fs = await api.files(pid);
    setFiles(fs);
    return fs;
  }, []);

  useEffect(() => {
    if (!activeProject) {
      setFiles([]);
      setActive(null);
      return;
    }
    let cancelled = false;
    loadFiles(activeProject.id)
      .then((fs) => {
        if (cancelled) return;
        const first = fs.find((f) => !f.isExample) ?? fs[0];
        setActive(first ? first.name : null);
      })
      .catch((e) => !cancelled && setError(msg(e)));
    return () => {
      cancelled = true;
    };
  }, [activeProject, loadFiles]);

  const reload = useCallback(async (pid: string, name: string) => {
    const [v, d, g] = await Promise.all([
      api.vars(pid, name),
      api.diff(pid, name),
      api.groups(pid, name),
    ]);
    setVars(v.vars);
    setDiff(d);
    setGroups(g);
  }, []);

  useEffect(() => {
    if (activeProject && active) reload(activeProject.id, active).catch((e) => setError(msg(e)));
  }, [activeProject, active, reload]);

  const run = async (fn: () => Promise<unknown>) => {
    if (!activeProject || !active) return;
    const pid = activeProject.id;
    setError(null);
    try {
      await fn();
      await reload(pid, active);
    } catch (e) {
      setError(msg(e));
      try {
        const fs = await loadFiles(pid);
        if (fs.some((f) => f.name === active)) await reload(pid, active);
        else setActive((fs.find((f) => !f.isExample) ?? fs[0])?.name ?? null);
      } catch {
        /* el error original ya se mostró */
      }
    }
  };

  const addProject = async (dir: string) => {
    setError(null);
    try {
      const p = await api.addProject(dir);
      setProjects(await api.projects());
      setActiveProject(p);
      setBrowsing(false);
    } catch (e) {
      setError(msg(e));
    }
  };

  const removeProject = async (id: string) => {
    setError(null);
    try {
      await api.removeProject(id);
      const list = await api.projects();
      setProjects(list);
      setActiveProject((cur) => (cur?.id === id ? (list[0] ?? null) : cur));
    } catch (e) {
      setError(msg(e));
    }
  };

  const activateProfile = async () => {
    if (!activeProject || !active || active === ".env") return;
    const ok = window.confirm(
      `Esto sobrescribirá .env con «${active}». Se guardará una copia en .env.bak. ¿Continuar?`,
    );
    if (!ok) return;
    setError(null);
    try {
      await api.activate(activeProject.id, active);
      await loadFiles(activeProject.id);
      setActive(".env");
    } catch (e) {
      setError(msg(e));
    }
  };

  const createProfile = async (name: string, from?: string) => {
    if (!activeProject) return;
    setError(null);
    try {
      await api.createFile(activeProject.id, name, from);
      await loadFiles(activeProject.id);
      setActive(name);
      setNewProfile(false);
    } catch (e) {
      setError(msg(e));
    }
  };

  // Los grupos son metadata de presentación: se guardan aparte (no en el .env)
  // de forma optimista; si el guardado falla, recargamos el estado del servidor.
  const persistGroups = async (pid: string, name: string, next: FileGroups) => {
    setGroups(next);
    try {
      await api.saveGroups(pid, name, next);
    } catch (e) {
      setError(msg(e));
      api.groups(pid, name).then(setGroups).catch(() => {});
    }
  };

  const mutateGroups = (next: FileGroups) => {
    if (activeProject && active) persistGroups(activeProject.id, active, next);
  };

  const addGroup = (name: string) =>
    mutateGroups({ ...groups, groups: [...groups.groups, { id: crypto.randomUUID(), name }] });

  const renameGroup = (id: string, name: string) =>
    mutateGroups({
      ...groups,
      groups: groups.groups.map((g) => (g.id === id ? { ...g, name } : g)),
    });

  const deleteGroup = (id: string) =>
    mutateGroups({
      groups: groups.groups.filter((g) => g.id !== id),
      assignments: Object.fromEntries(
        Object.entries(groups.assignments).filter(([, gid]) => gid !== id),
      ),
    });

  const assignVar = (key: string, id: string | null) => {
    const assignments = { ...groups.assignments };
    if (id) assignments[key] = id;
    else delete assignments[key];
    mutateGroups({ ...groups, assignments });
  };

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });

  const enabledCount = vars.filter((v) => v.enabled).length;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="logo">envis</span>
        </div>
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id} className={"project-item" + (p.id === activeProject?.id ? " active" : "")}>
              <button className="project-pick" onClick={() => setActiveProject(p)} title={p.dir}>
                <span className="project-name">{p.name}</span>
                <span className="project-dir">{p.dir}</span>
              </button>
              {!isolated && (
                <button
                  className="project-remove"
                  onClick={() => removeProject(p.id)}
                  title="quitar del registro (no borra archivos)"
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {projects.length === 0 && <li className="empty">sin proyectos</li>}
        </ul>
        {!isolated && (
          <button className="add-project" onClick={() => setBrowsing(true)}>
            + Añadir proyecto
          </button>
        )}
      </aside>

      <main className="panel">
        {error && (
          <div className="error" onClick={() => setError(null)} title="ocultar">
            {error}
          </div>
        )}

        {activeProject ? (
          <>
            <header className="topbar">
              <span className="project" title={activeProject.dir}>
                {activeProject.dir}
              </span>
              <div className="topbar-actions">
                {active && active !== ".env" && (
                  <button className="btn" onClick={activateProfile}>
                    Volcar «{active}» → .env
                  </button>
                )}
                {active && (
                  <span className="count">
                    {enabledCount}/{vars.length} activas
                  </span>
                )}
              </div>
            </header>

            <nav className="tabs">
              {files.map((f) => (
                <button
                  key={f.name}
                  className={[
                    "tab",
                    f.name === active ? "active" : "",
                    f.isExample ? "example" : "",
                  ].join(" ")}
                  onClick={() => setActive(f.name)}
                >
                  {f.name}
                </button>
              ))}
              <span className="tabs-spacer" />
              <button className="tab ghost" onClick={() => setNewProfile(true)}>
                + perfil
              </button>
              {files.length >= 2 && (
                <button className="tab ghost" onClick={() => setComparing(true)}>
                  ⇄ comparar
                </button>
              )}
            </nav>

            {active && (
              <>
                {diff && diff.missing.length > 0 && (
                  <div className="missing">
                    <span className="missing-label">
                      Faltan respecto a <code>{diff.example}</code>:
                    </span>
                    {diff.missing.map((k) => (
                      <button
                        key={k}
                        className="chip"
                        onClick={() => run(() => api.add(activeProject.id, active, k, ""))}
                      >
                        + {k}
                      </button>
                    ))}
                  </div>
                )}

                <VarList
                  vars={vars}
                  groups={groups}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  onToggle={(line) => run(() => api.toggle(activeProject.id, active, line))}
                  onSave={(line, value) => run(() => api.setValue(activeProject.id, active, line, value))}
                  onRemove={(line) => run(() => api.remove(activeProject.id, active, line))}
                  onAdd={(k, val) => run(() => api.add(activeProject.id, active, k, val))}
                  onAssign={assignVar}
                  onAddGroup={addGroup}
                  onRenameGroup={renameGroup}
                  onDeleteGroup={deleteGroup}
                />
              </>
            )}
          </>
        ) : (
          <div className="empty-state">
            <p>No hay ningún proyecto. Añade uno para empezar.</p>
            <button className="add-project" onClick={() => setBrowsing(true)}>
              + Añadir proyecto
            </button>
          </div>
        )}
      </main>

      {browsing && <FolderBrowser onAdd={addProject} onClose={() => setBrowsing(false)} />}
      {newProfile && (
        <NewProfileModal files={files} onCreate={createProfile} onClose={() => setNewProfile(false)} />
      )}
      {comparing && activeProject && (
        <CompareModal pid={activeProject.id} files={files} onClose={() => setComparing(false)} />
      )}
    </div>
  );
}

function FolderBrowser({ onAdd, onClose }: { onAdd: (dir: string) => void; onClose: () => void }) {
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const go = useCallback((path?: string) => {
    api
      .browse(path)
      .then((r) => {
        setResult(r);
        setPathInput(r.path);
        setErr(null);
      })
      .catch((e) => setErr(msg(e)));
  }, []);

  useEffect(() => {
    go();
  }, [go]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Añadir proyecto</strong>
          <button className="remove" onClick={onClose} aria-label="cerrar">
            ×
          </button>
        </div>

        <div className="browser-bar">
          <button
            className="btn"
            onClick={() => result?.parent && go(result.parent)}
            disabled={!result?.parent}
            title="subir"
          >
            ↑
          </button>
          <input
            className="value"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go(pathInput)}
            spellCheck={false}
          />
          <button className="btn" onClick={() => go(pathInput)}>
            Ir
          </button>
        </div>

        {err && <div className="error">{err}</div>}

        <ul className="folder-list">
          {result?.entries.map((e) => (
            <li key={e.path} className="folder">
              <button className="folder-name" onClick={() => go(e.path)}>
                <span className="folder-icon">📁</span>
                {e.name}
                {e.hasEnv && <span className="badge-env">.env</span>}
              </button>
              <button className="add-btn" onClick={() => onAdd(e.path)} title="añadir esta carpeta">
                +
              </button>
            </li>
          ))}
          {result && result.entries.length === 0 && <li className="empty">— sin subcarpetas —</li>}
        </ul>

        <div className="modal-foot">
          <button className="btn primary" onClick={() => result && onAdd(result.path)} disabled={!result}>
            Añadir esta carpeta
          </button>
        </div>
      </div>
    </div>
  );
}

function NewProfileModal({
  files,
  onCreate,
  onClose,
}: {
  files: EnvFileInfo[];
  onCreate: (name: string, from?: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(".env.");
  const [from, setFrom] = useState("");
  const valid = name.startsWith(".env.") && name.length > 5;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Nuevo perfil</strong>
          <button className="remove" onClick={onClose} aria-label="cerrar">
            ×
          </button>
        </div>
        <div className="form">
          <label>
            Nombre del fichero
            <input
              className="value"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder=".env.staging"
              spellCheck={false}
              autoFocus
            />
          </label>
          <label>
            Duplicar desde
            <select className="value" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">(vacío)</option>
              {files.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn primary" disabled={!valid} onClick={() => onCreate(name, from || undefined)}>
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

function CompareModal({
  pid,
  files,
  onClose,
}: {
  pid: string;
  files: EnvFileInfo[];
  onClose: () => void;
}) {
  const [a, setA] = useState(files[0]?.name ?? "");
  const [b, setB] = useState(files[1]?.name ?? files[0]?.name ?? "");
  const [result, setResult] = useState<Comparison | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    setErr(null);
    api
      .compare(pid, a, b)
      .then(setResult)
      .catch((e) => setErr(msg(e)));
  }, [pid, a, b]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Comparar perfiles</strong>
          <button className="remove" onClick={onClose} aria-label="cerrar">
            ×
          </button>
        </div>

        <div className="compare-bar">
          <select className="value" value={a} onChange={(e) => setA(e.target.value)}>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <span className="compare-vs">⇄</span>
          <select className="value" value={b} onChange={(e) => setB(e.target.value)}>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {err && <div className="error">{err}</div>}

        <div className="compare-body">
          {result && (
            <>
              <h4>
                Distintas <span className="muted">({result.different.length})</span>
              </h4>
              {result.different.length === 0 ? (
                <p className="empty">— sin diferencias de valor —</p>
              ) : (
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>clave</th>
                      <th>{a}</th>
                      <th>{b}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.different.map((d) => (
                      <tr key={d.key}>
                        <td className="ckey">{d.key}</td>
                        <td>{d.a}</td>
                        <td>{d.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h4>
                Solo en <code>{a}</code> <span className="muted">({result.onlyInA.length})</span>
              </h4>
              <p className="keylist">{result.onlyInA.join(", ") || "—"}</p>

              <h4>
                Solo en <code>{b}</code> <span className="muted">({result.onlyInB.length})</span>
              </h4>
              <p className="keylist">{result.onlyInB.join(", ") || "—"}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VarRow({
  v,
  groups,
  groupId,
  onToggle,
  onSave,
  onRemove,
  onAssign,
}: {
  v: Var;
  groups: Group[];
  groupId: string | null;
  onToggle: () => void;
  onSave: (value: string) => void;
  onRemove: () => void;
  onAssign: (groupId: string | null) => void;
}) {
  const [draft, setDraft] = useState(v.value);
  useEffect(() => setDraft(v.value), [v.value]);
  const dirty = draft !== v.value;

  return (
    <li className={"row" + (v.enabled ? "" : " disabled")}>
      <button
        className={"switch" + (v.enabled ? " on" : "")}
        onClick={onToggle}
        aria-label={v.enabled ? "desactivar" : "activar"}
      />
      <span className="key" title={v.isExport ? "export" : undefined}>
        {v.key}
      </span>
      <input
        className="value"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => dirty && onSave(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(v.value);
        }}
        spellCheck={false}
      />
      {groups.length > 0 && (
        <select
          className="group-select"
          value={groupId ?? ""}
          onChange={(e) => onAssign(e.target.value || null)}
          title="grupo"
        >
          <option value="">—</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <button className="remove" onClick={onRemove} aria-label="eliminar">
        ×
      </button>
    </li>
  );
}

function VarList({
  vars,
  groups,
  collapsed,
  onToggleCollapse,
  onToggle,
  onSave,
  onRemove,
  onAdd,
  onAssign,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  vars: Var[];
  groups: FileGroups;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onToggle: (line: number) => void;
  onSave: (line: number, value: string) => void;
  onRemove: (line: number) => void;
  onAdd: (key: string, value: string) => void;
  onAssign: (key: string, groupId: string | null) => void;
  onAddGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
}) {
  const sections = groupVars(vars, groups);
  const hasGroups = groups.groups.length > 0;
  const ungrouped = sections.find((s) => !s.group)?.vars ?? [];

  const rows = (list: Var[]) =>
    list.map((v) => (
      <VarRow
        key={v.line}
        v={v}
        groups={hasGroups ? groups.groups : []}
        groupId={groups.assignments[v.key] ?? null}
        onToggle={() => onToggle(v.line)}
        onSave={(value) => onSave(v.line, value)}
        onRemove={() => onRemove(v.line)}
        onAssign={(gid) => onAssign(v.key, gid)}
      />
    ));

  return (
    <div className="var-groups">
      {sections
        .filter((s) => s.group)
        .map((s) => {
          const g = s.group!;
          const isCollapsed = collapsed.has(g.id);
          return (
            <section className="group" key={g.id}>
              <GroupHeader
                group={g}
                count={s.vars.length}
                collapsed={isCollapsed}
                onToggle={() => onToggleCollapse(g.id)}
                onRename={(name) => onRenameGroup(g.id, name)}
                onDelete={() => onDeleteGroup(g.id)}
              />
              {!isCollapsed && (
                <ul className="vars">
                  {s.vars.length ? rows(s.vars) : <li className="empty">— sin variables —</li>}
                </ul>
              )}
            </section>
          );
        })}

      <section className="group">
        {hasGroups && ungrouped.length > 0 && (
          <div className="group-head ungrouped">
            <span className="group-name muted">Sin agrupar</span>
          </div>
        )}
        <ul className="vars">
          {rows(ungrouped)}
          <AddRow onAdd={onAdd} />
        </ul>
      </section>

      <AddGroup onAdd={onAddGroup} />
    </div>
  );
}

function GroupHeader({
  group,
  count,
  collapsed,
  onToggle,
  onRename,
  onDelete,
}: {
  group: Group;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.name]);

  return (
    <div className="group-head">
      <button
        className="group-toggle"
        onClick={onToggle}
        aria-label={collapsed ? "expandir" : "colapsar"}
      >
        {collapsed ? "▸" : "▾"}
      </button>
      <input
        className="group-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim();
          if (n && n !== group.name) onRename(n);
          else setName(group.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setName(group.name);
        }}
        spellCheck={false}
      />
      <span className="group-count">{count}</span>
      <button
        className="remove"
        onClick={onDelete}
        aria-label="borrar grupo"
        title="borrar grupo (sus variables vuelven a «Sin agrupar»)"
      >
        ×
      </button>
    </div>
  );
}

function AddGroup({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n);
    setName("");
  };

  return (
    <div className="add-group">
      <input
        className="value"
        placeholder="+ nuevo grupo"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        spellCheck={false}
      />
      <button className="add-btn" onClick={submit} disabled={!name.trim()} aria-label="crear grupo">
        +
      </button>
    </div>
  );
}

function AddRow({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const valid = KEY_RE.test(key);

  const submit = () => {
    if (!valid) return;
    onAdd(key, value);
    setKey("");
    setValue("");
  };

  return (
    <li className="row add">
      <span className="switch placeholder" />
      <input
        className="key-input"
        placeholder="NUEVA_VARIABLE"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        spellCheck={false}
      />
      <input
        className="value"
        placeholder="valor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        spellCheck={false}
      />
      <button className="add-btn" onClick={submit} disabled={!valid} aria-label="añadir">
        +
      </button>
    </li>
  );
}
