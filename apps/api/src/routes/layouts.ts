import { Hono } from 'hono'
import type { AppEnv } from '../app.js'
export const layoutsRoutes = new Hono<AppEnv>()
