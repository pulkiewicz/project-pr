declare const Netlify: { env: { get(name: string): string | undefined } } | undefined

/** Odczyt zmiennej środowiskowej: Netlify.env w runtime Functions, process.env lokalnie i w testach. */
export function env(name: string): string | undefined {
  const fromNetlify = typeof Netlify !== 'undefined' ? Netlify?.env.get(name) : undefined
  return fromNetlify ?? process.env[name]
}

export function requireEnv(name: string): string {
  const value = env(name)
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}
