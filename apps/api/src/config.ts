export type Config = { databaseUrl: string; blobToken: string; apiKey: string; webOrigin: string; blobDir?: string }

const VARS = { databaseUrl: 'DATABASE_URL', blobToken: 'BLOB_READ_WRITE_TOKEN', apiKey: 'API_KEY', webOrigin: 'WEB_ORIGIN' } as const

/** Reads the environment once at startup; a missing variable is a startup error, not a runtime surprise. */
export function readConfig(env: Record<string, string | undefined>): Config {
  // BLOB_DIR opts into local, file-backed blob storage; when it's set, BLOB_READ_WRITE_TOKEN is optional.
  const blobDir = env.BLOB_DIR
  const missing = Object.values(VARS).filter((name) => {
    if (name === VARS.blobToken && blobDir) return false
    return !env[name]
  })
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  return {
    databaseUrl: env.DATABASE_URL!,
    blobToken: env.BLOB_READ_WRITE_TOKEN ?? '',
    apiKey: env.API_KEY!,
    // The CORS check compares against the browser's `Origin` header, which never carries a trailing
    // slash; a copy-pasted `https://app.example.com/` would otherwise block every request.
    webOrigin: env.WEB_ORIGIN!.replace(/\/+$/, ''),
    ...(blobDir ? { blobDir } : {}),
  }
}
