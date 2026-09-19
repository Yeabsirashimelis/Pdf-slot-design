import { Hono } from 'hono'
import type { AppEnv } from '../app.js'
export const filesRoutes = new Hono<AppEnv>()
