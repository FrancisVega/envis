import { describe, it, expect } from "vitest";
import { groupVars, type FileGroups } from "./groups";

const vars = (...keys: string[]) => keys.map((key) => ({ key }));

describe("groupVars", () => {
  it("sin grupos: todo cae en 'Sin agrupar'", () => {
    const out = groupVars(vars("A", "B"), { groups: [], assignments: {} });
    expect(out).toEqual([{ group: null, vars: [{ key: "A" }, { key: "B" }] }]);
  });

  it("reparte por asignación y respeta el orden de los grupos", () => {
    const fg: FileGroups = {
      groups: [
        { id: "g1", name: "acceso" },
        { id: "g2", name: "endpoints" },
      ],
      assignments: { USER: "g1", PASS: "g1", API: "g2" },
    };
    const out = groupVars(vars("API", "USER", "PASS"), fg);
    expect(out.map((s) => s.group?.name)).toEqual(["acceso", "endpoints"]);
    expect(out[0].vars.map((v) => v.key)).toEqual(["USER", "PASS"]);
    expect(out[1].vars.map((v) => v.key)).toEqual(["API"]);
  });

  it("mantiene el orden del fichero dentro de cada grupo", () => {
    const fg: FileGroups = { groups: [{ id: "g", name: "g" }], assignments: { A: "g", B: "g" } };
    const out = groupVars(vars("B", "A"), fg);
    expect(out[0].vars.map((v) => v.key)).toEqual(["B", "A"]);
  });

  it("una clave asignada a un grupo inexistente cae en 'Sin agrupar'", () => {
    const fg: FileGroups = { groups: [{ id: "g1", name: "g1" }], assignments: { A: "fantasma" } };
    const out = groupVars(vars("A"), fg);
    expect(out).toEqual([
      { group: { id: "g1", name: "g1" }, vars: [] },
      { group: null, vars: [{ key: "A" }] },
    ]);
  });

  it("muestra grupos vacíos pero omite 'Sin agrupar' si no recoge nada", () => {
    const fg: FileGroups = {
      groups: [
        { id: "g1", name: "uno" },
        { id: "g2", name: "dos" },
      ],
      assignments: { A: "g1", B: "g1" },
    };
    const out = groupVars(vars("A", "B"), fg);
    expect(out.map((s) => s.group?.name)).toEqual(["uno", "dos"]);
    expect(out[1].vars).toEqual([]);
  });

  it("claves duplicadas comparten grupo", () => {
    const fg: FileGroups = { groups: [{ id: "g", name: "g" }], assignments: { DB: "g" } };
    const out = groupVars(vars("DB", "DB"), fg);
    expect(out[0].vars).toEqual([{ key: "DB" }, { key: "DB" }]);
  });
});
