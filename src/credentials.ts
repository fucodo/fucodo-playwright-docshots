export interface Persona {
  username: string;
  /** Avoid committing real passwords – prefer passwordEnv. */
  password?: string;
  /** Name of the environment variable holding the password. */
  passwordEnv?: string;
}

export type PersonaRegistry = Record<string, Persona>;

export interface Credentials {
  persona: string;
  username: string;
  password: string;
}

/** Custom lookup, e.g. a vault/KeePass/1Password CLI call. */
export type CredentialsResolver = (persona: string, explicitPassword?: string) => Credentials | Promise<Credentials>;

export function envName(persona: string): string {
  return `DOCSHOT_PW_${persona.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * Lookup order: password in the step → registry `password` → registry `passwordEnv` → DOCSHOT_PW_<PERSONA>.
 * Unknown personas fall back to "username = persona name" only when allowUnknown is set.
 */
export function createCredentialsResolver(personas: PersonaRegistry = {}, allowUnknown = false): CredentialsResolver {
  return (name, explicitPassword) => {
    const persona = personas[name] ?? (allowUnknown ? { username: name } : undefined);
    if (!persona) {
      const known = Object.keys(personas);
      throw new Error(
        `Unbekannte Persona "${name}".` + (known.length ? ` Bekannt: ${known.join(', ')}` : ' Es sind keine Personas konfiguriert.'),
      );
    }
    const password =
      explicitPassword ??
      persona.password ??
      (persona.passwordEnv ? process.env[persona.passwordEnv] : undefined) ??
      process.env[envName(name)];

    if (!password) {
      const hint = [persona.passwordEnv, envName(name)].filter(Boolean).join(' oder ');
      throw new Error(`Kein Passwort für Persona "${name}" gefunden. Bitte ${hint} setzen oder im Schritt angeben.`);
    }
    return { persona: name, username: persona.username, password };
  };
}
