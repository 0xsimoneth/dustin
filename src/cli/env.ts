/**
 * Loads `.env` from the working directory if it exists, using Node's built-in loader
 * (no dotenv dependency). Only the CLI does this; the SDK never reads the environment.
 */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
