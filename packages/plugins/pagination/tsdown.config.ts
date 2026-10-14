import { defineConfig } from 'tsdown'
import { onSuccess } from '../onSuccess'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs'],
  target: 'es2020',
  dts: true,
  clean: true,
  outDir: 'dist',
  onSuccess: onSuccess('pagination'),
})
