import { defineConfig } from 'nitro'

export default defineConfig({
  modules: ['workflow/nitro'],
  routes: { '/**': './src/index.ts' },
  // The five TTFs the renderer embeds, bundled from packages/core so the
  // server never carries a second copy that could drift from the editor's.
  serverAssets: [{ baseName: 'fonts', dir: '../../packages/core/src/fonts/files' }],
})
