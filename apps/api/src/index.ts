import { createApp } from './app.js'
import { productionDeps } from './runtime.js'

export default createApp(await productionDeps())
