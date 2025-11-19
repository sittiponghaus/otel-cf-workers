import { instrument, getLogger, ConsoleTransport } from '@inference-net/otel-cf-workers'

interface Env {}

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const logger = getLogger('app')

		// Just logs, no tracing
		logger.info('Request received')

		logger.debug('Processing request', {
			url: request.url,
			method: request.method,
		})

		logger.warn('This is a warning', {
			some_metric: 95,
			threshold: 100,
		})

		return new Response('OK')
	},
}

export default instrument(handler, {
	service: {
		name: 'logs-only-worker',
	},
	// No trace configuration - traces disabled
	logs: {
		transports: [
			// Only console output, no OTLP export
			new ConsoleTransport({
				pretty: true,
			}),
		],
		batching: {
			strategy: 'immediate', // Export immediately
		},
	},
})
