import { instrument, getLogger, OTLPTransport, ConsoleTransport } from '@inference-net/otel-cf-workers'
import { trace } from '@opentelemetry/api'

interface Env {
	OTEL_ENDPOINT: string
	OTEL_API_KEY: string
}

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const logger = getLogger('handler')

		// Logs are automatically correlated with the active span
		logger.info('Request received', {
			user_agent: request.headers.get('user-agent'),
			content_type: request.headers.get('content-type'),
		})

		// Create custom spans - logs inside will be correlated
		const tracer = trace.getTracer('my-app')
		return await tracer.startActiveSpan('process-request', async (span) => {
			span.setAttribute('http.method', request.method)

			const logger = getLogger('business-logic')

			logger.info('Processing business logic')

			// Nested spans and logs all share the same trace context
			await tracer.startActiveSpan('database-query', async (dbSpan) => {
				logger.debug('Executing database query', {
					'db.system': 'postgresql',
					'db.statement': 'SELECT * FROM users',
				})

				// Simulate DB work
				await new Promise((resolve) => setTimeout(resolve, 50))

				logger.info('Query complete', {
					'db.rows_returned': 42,
				})

				dbSpan.end()
			})

			span.end()

			return new Response('OK')
		})
	},
}

export default instrument(handler, {
	service: {
		name: 'advanced-worker',
		version: '2.0.0',
		namespace: 'production',
	},
	trace: {
		exporter: {
			url: `${process.env.OTEL_ENDPOINT}/v1/traces`,
			headers: {
				Authorization: `Bearer ${process.env.OTEL_API_KEY}`,
			},
		},
		batching: {
			strategy: 'trace', // Group spans by trace
		},
	},
	logs: {
		transports: [
			new OTLPTransport({
				url: `${process.env.OTEL_ENDPOINT}/v1/logs`,
				headers: {
					Authorization: `Bearer ${process.env.OTEL_API_KEY}`,
				},
			}),
			// Console transport for debugging
			new ConsoleTransport({
				pretty: true,
				colors: true,
			}),
		],
		batching: {
			strategy: 'size', // Batch by size for logs
			maxQueueSize: 500,
		},
		instrumentation: {
			instrumentConsole: false, // Opt-in console instrumentation
		},
	},
})
