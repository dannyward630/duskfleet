import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { expandHome, isDirectory } from "../config/loader.js";
import type { DuskFleetConfig } from "../config/types.js";

export class ProjectValidationError extends Error {
  override readonly name = "ProjectValidationError";
}

/**
 * Validates a project path before anything is executed against it.
 *
 * Rules:
 *  - must be absolute (after ~ expansion)
 *  - must exist and be a directory
 *  - symlinks are resolved; the real path is what gets used as cwd
 *  - must not be `/` or the user's home directory itself
 *  - when allowed_project_roots is non-empty, must be inside one of them
 */
export function validateProjectPath(input: string, config: DuskFleetConfig): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new ProjectValidationError("project path is empty");
  }
  const expanded = expandHome(input.trim());
  if (!path.isAbsolute(expanded)) {
    throw new ProjectValidationError(`project path must be absolute: ${input}`);
  }
  if (!isDirectory(expanded)) {
    throw new ProjectValidationError(`project path is not an existing directory: ${expanded}`);
  }
  const real = realpathSync(expanded);
  const home = realpathSync(homedir());
  if (real === path.parse(real).root || real === home) {
    throw new ProjectValidationError(`refusing to run against ${real}: choose a specific project directory`);
  }
  if (config.allowedProjectRoots.length > 0) {
    const inside = config.allowedProjectRoots.some((root) => {
      let realRoot: string;
      try {
        realRoot = realpathSync(root);
      } catch {
        return false;
      }
      const rel = path.relative(realRoot, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!inside) {
      throw new ProjectValidationError(
        `project path ${real} is outside allowed_project_roots (${config.allowedProjectRoots.join(", ")})`,
      );
    }
  }
  return real;
}
