import type { Config, Context } from '@netlify/functions'
import { createApp } from '../../server/app.ts'
import { runtimeDeps } from '../../server/runtime.ts'

const app = createApp(runtimeDeps())

export default (req: Request, context: Context) => app.fetch(req, { context })

export const config: Config = { path: '/api/*' }
