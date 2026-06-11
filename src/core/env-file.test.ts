import { describe, it, expect } from "vitest";
import { EnvFile, compareEnvFiles, diffWithExample } from "./env-file";

const SAMPLE = `# Base de datos
DATABASE_URL=postgres://localhost/dev
# DATABASE_URL=postgres://prod/db

DEBUG=true
PORT = 3000
SECRET="un valor con espacios"
EMPTY=
export NODE_ENV=development
GREETING=hello # saludo
`;

describe("EnvFile", () => {
  it("round-trips sin pérdidas (parse → serialize idéntico)", () => {
    expect(EnvFile.parse(SAMPLE).serialize()).toBe(SAMPLE);
  });

  it("clasifica variables activas y desactivadas", () => {
    const ef = EnvFile.parse(SAMPLE);
    const active = ef.vars.filter((v) => v.enabled).map((v) => v.key);
    expect(active).toEqual(["DATABASE_URL", "DEBUG", "PORT", "SECRET", "EMPTY", "NODE_ENV", "GREETING"]);
    const disabled = ef.vars.filter((v) => !v.enabled).map((v) => v.key);
    expect(disabled).toEqual(["DATABASE_URL"]);
  });

  it("parsea valores entrecomillados, vacíos y comentarios inline", () => {
    const ef = EnvFile.parse(SAMPLE);
    expect(ef.vars.find((v) => v.key === "SECRET")!.value).toBe("un valor con espacios");
    expect(ef.vars.find((v) => v.key === "EMPTY")!.value).toBe("");
    expect(ef.vars.find((v) => v.key === "NODE_ENV")!.isExport).toBe(true);
    const greeting = ef.vars.find((v) => v.key === "GREETING")!;
    expect(greeting.value).toBe("hello");
    expect(greeting.inlineComment).toBe("saludo");
  });

  it("toggle desactiva y reactiva preservando el resto de la línea", () => {
    const ef = EnvFile.parse(SAMPLE);
    const debug = ef.vars.find((v) => v.key === "DEBUG" && v.enabled)!;
    expect(ef.toggle(debug.line)).toBe(false);
    expect(ef.serialize()).toContain("# DEBUG=true");
    expect(ef.toggle(debug.line)).toBe(true);
    expect(ef.serialize()).toBe(SAMPLE);
  });

  it("setValue entrecomilla cuando el valor lleva espacios", () => {
    const ef = EnvFile.parse(SAMPLE);
    const debug = ef.vars.find((v) => v.key === "DEBUG")!;
    ef.setValue(debug.line, "a b");
    expect(ef.serialize()).toContain('DEBUG="a b"');
  });

  it("añade y elimina variables", () => {
    const ef = EnvFile.parse(SAMPLE);
    ef.add("NEW_VAR", "x");
    expect(ef.serialize()).toContain("NEW_VAR=x");
    const nv = ef.vars.find((v) => v.key === "NEW_VAR")!;
    ef.remove(nv.line);
    expect(ef.serialize()).not.toContain("NEW_VAR");
  });

  it("conserva el salto de línea final al añadir", () => {
    const ef = EnvFile.parse("A=1\n");
    ef.add("B", "2");
    expect(ef.serialize()).toBe("A=1\nB=2\n");
  });
});

describe("diffWithExample", () => {
  it("detecta claves que faltan y que sobran", () => {
    const env = EnvFile.parse("A=1\nB=2\n");
    const example = EnvFile.parse("A=\nC=\n");
    const { missing, extra } = diffWithExample(env, example);
    expect(missing).toEqual(["C"]);
    expect(extra).toEqual(["B"]);
  });
});

describe("compareEnvFiles", () => {
  it("clasifica claves iguales, distintas y exclusivas (solo activas)", () => {
    const a = EnvFile.parse("SHARED=1\nONLY_A=x\nDIFF=foo\n# OFF=z\n");
    const b = EnvFile.parse("SHARED=1\nONLY_B=y\nDIFF=bar\n");
    const r = compareEnvFiles(a, b);
    expect(r.equal).toEqual(["SHARED"]);
    expect(r.onlyInA).toEqual(["ONLY_A"]);
    expect(r.onlyInB).toEqual(["ONLY_B"]);
    expect(r.different).toEqual([{ key: "DIFF", a: "foo", b: "bar" }]);
  });
});
