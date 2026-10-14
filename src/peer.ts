import path from 'node:path';

/**
 * Loads a peer dependency from the *project* (process.cwd()) first.
 *
 * playwright-bdd keeps its step registry per module instance. If the package
 * got its own nested copy (symlinked/file: installs, version mismatches), steps
 * registered here would be invisible to the project's bddgen – "no step definitions".
 */
export function peer<T>(name: string): T {
  try {
    return require(require.resolve(name, { paths: [process.cwd()] })) as T;
  } catch {
    return require(name) as T;
  }
}

/** Directory of a package as seen from the project and from this package. */
export function peerLocations(name: string): { project?: string; own?: string } {
  const at = (paths?: string[]) => {
    try {
      return path.dirname(require.resolve(`${name}/package.json`, paths ? { paths } : undefined));
    } catch {
      return undefined;
    }
  };
  return { project: at([process.cwd()]), own: at() };
}
