import { homedir } from "node:os";
import { join } from "node:path";

/** Directorio del registro de envis (`~/.config/envis`, override con `ENVIS_CONFIG_DIR`). */
export function configDir(): string {
  return process.env.ENVIS_CONFIG_DIR ?? join(homedir(), ".config", "envis");
}
