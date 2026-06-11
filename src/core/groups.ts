/**
 * Agrupación *de presentación* de variables .env.
 *
 * Los grupos NO se guardan en el fichero .env: son metadata lateral (ver
 * `server/groups.ts`, persistida en el registro por proyecto y fichero). Este
 * módulo solo contiene la lógica pura que cruza las variables de un fichero con
 * su mapa de grupos para producir las secciones que pinta la UI.
 *
 * La identidad es por **clave**, no por número de línea (que es inestable al
 * editar): una clave sin asignar —o asignada a un grupo que ya no existe— cae
 * en la sección "Sin agrupar". Si una clave aparece duplicada (p. ej. activa y
 * comentada a la vez), ambas entradas comparten grupo.
 */

export interface Group {
  id: string;
  name: string;
}

/** Estado de agrupación de un fichero: grupos (en orden) y a qué grupo va cada clave. */
export interface FileGroups {
  groups: Group[];
  /** clave de variable → id de grupo. */
  assignments: Record<string, string>;
}

/** Una sección ya repartida: un grupo (o `null` = "Sin agrupar") y sus variables. */
export interface GroupedVars<V> {
  group: Group | null;
  vars: V[];
}

/**
 * Reparte `vars` en secciones según `groups`/`assignments`.
 *
 * Devuelve una sección por cada grupo en su orden (aunque quede vacía, para que
 * la UI pueda mostrar un grupo recién creado) y, al final, la sección
 * "Sin agrupar" *solo si* recogió alguna variable. El orden de las variables
 * dentro de cada sección es el del fichero.
 */
export function groupVars<V extends { key: string }>(
  vars: readonly V[],
  { groups, assignments }: FileGroups,
): GroupedVars<V>[] {
  const buckets = new Map<string, V[]>(groups.map((g) => [g.id, []]));
  const ungrouped: V[] = [];
  for (const v of vars) {
    const gid = assignments[v.key];
    (gid !== undefined && buckets.has(gid) ? buckets.get(gid)! : ungrouped).push(v);
  }
  const sections: GroupedVars<V>[] = groups.map((g) => ({ group: g, vars: buckets.get(g.id)! }));
  if (ungrouped.length > 0) sections.push({ group: null, vars: ungrouped });
  return sections;
}
