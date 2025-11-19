import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
	define: {
		__PACKAGE_VERSION__: JSON.stringify(pkg.version),
		__PACKAGE_NAME__: JSON.stringify(pkg.name),
	},
	build: {
		lib: {
			entry: 'src/index.ts',
			formats: ['es'],
			fileName: 'index',
		},
		rollupOptions: {
			external: (id) => {
				// External all node_modules dependencies
				if (id.startsWith('node:')) return true
				if (!id.startsWith('.') && !id.startsWith('/')) return true
				return false
			},
		},
		sourcemap: true,
		target: 'esnext',
		minify: false,
	},
	plugins: [
		dts({
			rollupTypes: true,
			tsconfigPath: './tsconfig.json',
		}),
	],
})
