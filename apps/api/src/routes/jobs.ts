import { Hono } from 'hono'
import type { AppEnv } from '../app.js'
export const jobsRoutes = new Hono<AppEnv>()
