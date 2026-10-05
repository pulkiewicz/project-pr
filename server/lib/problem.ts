import type { ProblemDetails } from '#shared'

/** Błąd domenowy mapowany na odpowiedź RFC 7807 (`application/problem+json`). */
export class HttpProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail?: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(detail ?? code)
  }
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
}

export function problemResponse(status: number, code: string, detail?: string, extra: Record<string, unknown> = {}) {
  const body: ProblemDetails = {
    type: `urn:pmo:problem:${code}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    ...(detail ? { detail } : {}),
    ...extra,
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' },
  })
}

export const unauthorized = (code = 'unauthenticated', detail?: string) => new HttpProblem(401, code, detail)
export const forbidden = (code = 'forbidden', detail?: string) => new HttpProblem(403, code, detail)
export const notFound = (code = 'not_found', detail?: string) => new HttpProblem(404, code, detail)
export const conflict = (current: unknown) => new HttpProblem(409, 'version_conflict', undefined, { current })
