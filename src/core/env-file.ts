/**
 * Parser y serializador de ficheros .env *no destructivo*.
 *
 * A diferencia de `dotenv` (que parsea a un objeto y descarta comentarios,
 * orden y formato), aquí modelamos el fichero línea a línea. Cada renglón es
 * una "entrada" tipada y se conserva su texto original (`raw`). Las líneas que
 * no se tocan se vuelven a emitir tal cual, así editar una variable nunca
 * reescribe el resto del fichero.
 *
 * Las variables se identifican por su número de línea (`line`, 0-based), no por
 * su clave: un mismo `.env` suele tener la misma clave activa y comentada a la
 * vez (p. ej. una URL de dev y otra de prod), y agrupar por clave sería ambiguo.
 */

export interface EnvVar {
  kind: "var";
  /** Índice de la entrada dentro del fichero (= número de línea, 0-based). */
  line: number;
  key: string;
  /** Valor ya "limpio" (sin comillas envolventes ni comentario inline). */
  value: string;
  enabled: boolean;
  /** La línea usaba el prefijo `export`. */
  isExport: boolean;
  /** Espacios/tabs al inicio de la línea, preservados al regenerar. */
  indent: string;
  /** Comentario al final de la línea (sin el `#`), o `null`. */
  inlineComment: string | null;
  /** Texto original/regenerado de la línea. */
  raw: string;
}

export interface EnvComment {
  kind: "comment";
  line: number;
  raw: string;
}

export interface EnvBlank {
  kind: "blank";
  line: number;
  raw: string;
}

export type EnvEntry = EnvVar | EnvComment | EnvBlank;

const VAR_RE = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const DISABLED_VAR_RE = /^(\s*)#\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const BLANK_RE = /^\s*$/;

/** Extrae el valor y el posible comentario inline de la parte derecha del `=`. */
function parseValue(rest: string): { value: string; inlineComment: string | null } {
  const s = rest.replace(/^[ \t]+/, "");
  if (s === "") return { value: "", inlineComment: null };

  const quote = s[0];
  if (quote === '"' || quote === "'") {
    let i = 1;
    let out = "";
    while (i < s.length) {
      const c = s[i];
      if (c === "\\" && quote === '"' && i + 1 < s.length) {
        out += c + s[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) break;
      out += c;
      i += 1;
    }
    const after = s.slice(i + 1);
    return { value: out, inlineComment: extractInlineComment(after) };
  }

  const hashIdx = s.search(/\s#/);
  if (hashIdx >= 0) {
    return {
      value: s.slice(0, hashIdx).replace(/[ \t]+$/, ""),
      inlineComment: s.slice(hashIdx).replace(/^\s+#\s?/, ""),
    };
  }
  return { value: s.replace(/[ \t]+$/, ""), inlineComment: null };
}

function extractInlineComment(after: string): string | null {
  const m = after.match(/\s*#\s?(.*)$/);
  return m ? m[1] : null;
}

/** Entrecomilla un valor solo si lo necesita para no romperse al releerse. */
function formatValue(value: string): string {
  if (value === "") return "";
  if (/[\s#"]/.test(value)) {
    return '"' + value.replace(/"/g, '\\"') + '"';
  }
  return value;
}

function buildVarRaw(v: EnvVar): string {
  const prefix = v.indent + (v.enabled ? "" : "# ") + (v.isExport ? "export " : "");
  const comment = v.inlineComment != null ? " # " + v.inlineComment : "";
  return prefix + v.key + "=" + formatValue(v.value) + comment;
}

function parseLine(raw: string, line: number): EnvEntry {
  if (BLANK_RE.test(raw)) return { kind: "blank", line, raw };

  const dm = raw.match(DISABLED_VAR_RE);
  if (dm) {
    const { value, inlineComment } = parseValue(dm[4]);
    return mkVar(line, dm[3], value, false, !!dm[2], dm[1], inlineComment, raw);
  }

  const m = raw.match(VAR_RE);
  if (m) {
    const { value, inlineComment } = parseValue(m[4]);
    return mkVar(line, m[3], value, true, !!m[2], m[1], inlineComment, raw);
  }

  return { kind: "comment", line, raw };
}

function mkVar(
  line: number,
  key: string,
  value: string,
  enabled: boolean,
  isExport: boolean,
  indent: string,
  inlineComment: string | null,
  raw: string,
): EnvVar {
  return { kind: "var", line, key, value, enabled, isExport, indent, inlineComment, raw };
}

export class EnvFile {
  private entries: EnvEntry[];

  constructor(entries: EnvEntry[]) {
    this.entries = entries;
    this.reindex();
  }

  static parse(content: string): EnvFile {
    return new EnvFile(content.split("\n").map((raw, line) => parseLine(raw, line)));
  }

  private reindex(): void {
    this.entries.forEach((e, i) => {
      e.line = i;
    });
  }

  get allEntries(): readonly EnvEntry[] {
    return this.entries;
  }

  /** Solo las entradas que son variables (activas o desactivadas). */
  get vars(): EnvVar[] {
    return this.entries.filter((e): e is EnvVar => e.kind === "var");
  }

  private varAt(line: number): EnvVar {
    const e = this.entries[line];
    if (!e || e.kind !== "var") throw new Error(`No hay ninguna variable en la línea ${line}`);
    return e;
  }

  /** Activa/desactiva una variable preservando el formato de la línea. */
  toggle(line: number): boolean {
    const v = this.varAt(line);
    if (v.enabled) {
      v.raw = v.raw.replace(/^(\s*)/, "$1# ");
      v.enabled = false;
    } else {
      v.raw = v.raw.replace(/^(\s*)#[ \t]?/, "$1");
      v.enabled = true;
    }
    return v.enabled;
  }

  setValue(line: number, value: string): void {
    const v = this.varAt(line);
    v.value = value;
    v.raw = buildVarRaw(v);
  }

  add(key: string, value: string, opts: { enabled?: boolean } = {}): EnvVar {
    const v = mkVar(0, key, value, opts.enabled ?? true, false, "", null, "");
    v.raw = buildVarRaw(v);
    // Insertar antes del salto de línea final (entrada en blanco vacía) para no
    // dejar la variable sin newline al final del fichero.
    const last = this.entries[this.entries.length - 1];
    const at =
      last && last.kind === "blank" && last.raw === ""
        ? this.entries.length - 1
        : this.entries.length;
    this.entries.splice(at, 0, v);
    this.reindex();
    return v;
  }

  remove(line: number): void {
    this.varAt(line);
    this.entries.splice(line, 1);
    this.reindex();
  }

  serialize(): string {
    return this.entries.map((e) => e.raw).join("\n");
  }
}

/** Compara un `.env` con su `.env.example`: qué claves faltan y cuáles sobran. */
export function diffWithExample(
  env: EnvFile,
  example: EnvFile,
): { missing: string[]; extra: string[] } {
  const envKeys = new Set(env.vars.map((v) => v.key));
  const exampleKeys = new Set(example.vars.map((v) => v.key));
  return {
    missing: [...exampleKeys].filter((k) => !envKeys.has(k)),
    extra: [...envKeys].filter((k) => !exampleKeys.has(k)),
  };
}

export interface EnvComparison {
  onlyInA: string[];
  onlyInB: string[];
  different: { key: string; a: string; b: string }[];
  equal: string[];
}

/** Compara los valores *activos* de dos ficheros .env (para enfrentar perfiles). */
export function compareEnvFiles(a: EnvFile, b: EnvFile): EnvComparison {
  const ma = enabledMap(a);
  const mb = enabledMap(b);
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const different: { key: string; a: string; b: string }[] = [];
  const equal: string[] = [];
  for (const [key, va] of ma) {
    if (!mb.has(key)) onlyInA.push(key);
    else if (mb.get(key) !== va) different.push({ key, a: va, b: mb.get(key)! });
    else equal.push(key);
  }
  for (const key of mb.keys()) if (!ma.has(key)) onlyInB.push(key);
  return { onlyInA, onlyInB, different, equal };
}

function enabledMap(env: EnvFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of env.vars) if (v.enabled) m.set(v.key, v.value);
  return m;
}
