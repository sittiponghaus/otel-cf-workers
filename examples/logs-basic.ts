import { instrument, getLogger, OTLPTransport, ConsoleTransport } from '@inference-net/otel-cf-workers'

interface Env {
	HONEYCOMB_API_KEY: string
}

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const logger = getLogger('my-app')

		// Logs automatically include trace context (trace ID, span ID)
		logger.info('Processing request', {
			'http.url': request.url,
			'http.method': request.method,
		})

		try {
			// Do some work
			const result = await processRequest(request)

			logger.debug('Request processed successfully', {
				'result.size': result.length,
			})

			return new Response(result)
		} catch (error) {
			// Error logs automatically extract exception info
			logger.error(error as Error, {
				'request.url': request.url,
			})

			return new Response('Internal Server Error', { status: 500 })
		}
	},
}

async function processRequest(request: Request): Promise<string> {
	const logger = getLogger('processor')

	logger.debug('Starting processing')

	// Simulate work
	await new Promise((resolve) => setTimeout(resolve, 100))

	logger.info('Processing complete')

	return 'Hello, World!'
}

export default instrument(handler, {
	service: {
		name: 'my-worker',
		version: '1.0.0',
	},
	trace: {
		exporter: {
			url: 'https://api.honeycomb.io/v1/traces',
			headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY || '' },
		},
	},
	logs: {
		transports: [
			// Send logs to Honeycomb
			new OTLPTransport({
				url: 'https://api.honeycomb.io/v1/logs',
				headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY || '' },
			}),
			// Also pretty-print to console for local development
			new ConsoleTransport({
				pretty: true,
				includeTimestamp: true,
			}),
		],
		batching: {
			strategy: 'size',
			maxQueueSize: 100,
		},
	},
})
