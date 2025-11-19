import { instrument, getLogger, OTLPTransport, ConsoleTransport } from '@inference-net/otel-cf-workers'

interface Env {
	OTEL_ENDPOINT: string
}

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const logger = getLogger('app')

		// Parent logger with request-level context
		const requestLogger = logger.child({
			'request.id': crypto.randomUUID(),
			'request.method': request.method,
			'request.url': request.url,
		})

		requestLogger.info('Request started')
		// Logs include: request.id, request.method, request.url

		// Process user authentication
		const userId = await authenticateUser(request, requestLogger)

		// Create child logger with user context
		const userLogger = requestLogger.child({
			'user.id': userId,
			'user.role': 'admin',
		})

		userLogger.info('User authenticated')
		// Logs include: request.id, request.method, request.url, user.id, user.role

		// Business logic with user context
		await processUserRequest(userLogger)

		requestLogger.info('Request completed')
		// Back to request-level context (no user.id, user.role)

		return new Response('OK')
	},
}

async function authenticateUser(request: Request, logger: any): Promise<string> {
	const authLogger = logger.child({
		component: 'auth',
	})

	authLogger.debug('Validating credentials')
	// Logs include: request.*, component: 'auth'

	// Simulate auth
	const userId = 'user-123'

	authLogger.info('Authentication successful', { 'auth.method': 'bearer' })

	return userId
}

async function processUserRequest(logger: any): Promise<void> {
	// Database operation
	const dbLogger = logger.child({
		component: 'database',
		'db.system': 'postgresql',
	})

	dbLogger.debug('Executing query')
	// Logs include: request.*, user.*, component: 'database', db.system: 'postgresql'

	await new Promise((resolve) => setTimeout(resolve, 50))

	dbLogger.info('Query completed', { 'db.rows_returned': 42 })

	// Cache operation
	const cacheLogger = logger.child({
		component: 'cache',
	})

	cacheLogger.debug('Checking cache')
	// Logs include: request.*, user.*, component: 'cache'

	cacheLogger.warn('Cache miss', { 'cache.key': 'user:123:data' })
}

export default instrument(handler, {
	service: { name: 'child-logger-example' },
	logs: {
		transports: [
			new OTLPTransport({
				url: `${process.env.OTEL_ENDPOINT}/v1/logs`,
			}),
			new ConsoleTransport({ pretty: true }),
		],
	},
})

/*
Example output (pretty console):

[2025-11-19T15:00:00.000Z] INFO  Request started { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...' }
[2025-11-19T15:00:00.050Z] DEBUG Validating credentials { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', component: 'auth' }
[2025-11-19T15:00:00.100Z] INFO  Authentication successful { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', component: 'auth', auth.method: 'bearer' }
[2025-11-19T15:00:00.150Z] INFO  User authenticated { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', user.id: 'user-123', user.role: 'admin' }
[2025-11-19T15:00:00.200Z] DEBUG Executing query { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', user.id: 'user-123', user.role: 'admin', component: 'database', db.system: 'postgresql' }
[2025-11-19T15:00:00.250Z] INFO  Query completed { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', user.id: 'user-123', user.role: 'admin', component: 'database', db.system: 'postgresql', db.rows_returned: 42 }
[2025-11-19T15:00:00.300Z] DEBUG Checking cache { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', user.id: 'user-123', user.role: 'admin', component: 'cache' }
[2025-11-19T15:00:00.350Z] WARN  Cache miss { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...', user.id: 'user-123', user.role: 'admin', component: 'cache', cache.key: 'user:123:data' }
[2025-11-19T15:00:00.400Z] INFO  Request completed { request.id: 'abc-123', request.method: 'GET', request.url: 'https://...' }
*/
