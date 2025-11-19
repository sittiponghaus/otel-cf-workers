# OpenTelemetry Logs Support

## Overview

The `@inference-net/otel-cf-workers` package now supports OpenTelemetry Logs in addition to Traces. Logs are automatically correlated with active spans when both are configured.

## Quick Start

```typescript
import { instrument, getLogger, OTLPTransport } from '@inference-net/otel-cf-workers'

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const logger = getLogger('my-app')

		// Logs automatically include trace context
		logger.info('Processing request', {
			'http.url': request.url,
		})

		return new Response('OK')
	},
}

export default instrument(handler, {
	service: { name: 'my-worker' },
	logs: {
		transports: [
			new OTLPTransport({
				url: 'https://api.honeycomb.io/v1/logs',
				headers: { 'x-honeycomb-team': env.API_KEY },
			}),
		],
	},
})
```

## Logger API

### Convenience Methods (Recommended)

```typescript
const logger = getLogger('my-logger')

logger.trace('Trace message', { key: 'value' })
logger.debug('Debug message', { key: 'value' })
logger.info('Info message', { key: 'value' })
logger.warn('Warning message', { key: 'value' })
logger.error('Error message', { key: 'value' })
logger.error(new Error('Something failed'), { context: 'data' })
logger.fatal('Fatal message', { key: 'value' })
```

### Child Loggers (Context Inheritance)

Create child loggers that inherit attributes from parent loggers:

```typescript
const logger = getLogger('app')

// Parent logger with request context
const requestLogger = logger.child({
	'request.id': crypto.randomUUID(),
	'request.method': 'GET',
})

requestLogger.info('Processing request')
// Logs include: request.id, request.method

// Child logger with user context
const userLogger = requestLogger.child({
	'user.id': '123',
	'user.role': 'admin',
})

userLogger.info('User action')
// Logs include: request.id, request.method, user.id, user.role

// Grandchild logger with component context
const dbLogger = userLogger.child({
	component: 'database',
})

dbLogger.debug('Query executed')
// Logs include: request.id, request.method, user.id, user.role, component: 'database'
```

**Benefits:**

- Avoid repeating context attributes in every log
- Pass loggers through function calls to maintain context
- Child attributes override parent attributes (if same key)

### Raw Emit (Advanced)

```typescript
logger.emit({
	severityNumber: SEVERITY_NUMBERS.INFO,
	severityText: 'INFO',
	body: 'Custom log message',
	attributes: { custom: 'attributes' },
})
```

## Configuration

### Logs-Only Configuration

```typescript
export default instrument(handler, {
	service: { name: 'my-worker' },
	logs: {
		transports: [new OTLPTransport({ url: 'https://otel.example.com/v1/logs' })],
	},
})
```

### Traces + Logs Configuration

```typescript
export default instrument(handler, {
	service: { name: 'my-worker' },
	trace: {
		exporter: { url: 'https://otel.example.com/v1/traces' },
		batching: { strategy: 'trace' }, // Group by traceId
	},
	logs: {
		transports: [new OTLPTransport({ url: 'https://otel.example.com/v1/logs' })],
		batching: { strategy: 'size', maxQueueSize: 512 },
	},
})
```

## Transports

### OTLPTransport

Sends logs to OpenTelemetry-compatible backends:

```typescript
new OTLPTransport({
	url: 'https://api.honeycomb.io/v1/logs',
	headers: {
		'x-honeycomb-team': env.API_KEY,
	},
})
```

### ConsoleTransport

Pretty-prints logs to the console (great for development):

```typescript
new ConsoleTransport({
	pretty: true,
	colors: false,
	includeTimestamp: true,
})
```

### Multiple Transports

Send logs to multiple destinations:

```typescript
logs: {
  transports: [
    new OTLPTransport({ url: 'https://prod-otel.example.com/v1/logs' }),
    new ConsoleTransport({ pretty: true }),
  ],
}
```

### Custom Transports

Implement the `LogTransport` interface:

```typescript
class R2Transport implements LogTransport {
	readonly name = 'r2'

	export(logs: ReadableLogRecord[], callback: ExportResultCallback): void {
		// Write logs to R2, KV, etc.
	}

	async shutdown(): Promise<void> {}
}
```

## Batching Strategies

### Size-based (Default for Logs)

Batches logs until queue reaches max size:

```typescript
logs: {
  batching: {
    strategy: 'size',
    maxQueueSize: 512,
    maxExportBatchSize: 256,
  },
}
```

### Immediate (No Batching)

Exports each log immediately:

```typescript
logs: {
  batching: {
    strategy: 'immediate',
  },
}
```

## Automatic Trace Correlation

When both traces and logs are configured, logs automatically include trace context:

```typescript
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('app')
const logger = getLogger('app')

await tracer.startActiveSpan('operation', async (span) => {
	// This log automatically includes span.traceId and span.spanId
	logger.info('Inside span')

	span.end()
})
```

**Combining Trace Correlation + Child Loggers:**

```typescript
const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const logger = getLogger('app')

		// Create request-scoped logger
		const requestLogger = logger.child({
			'request.id': crypto.randomUUID(),
		})

		const tracer = trace.getTracer('app')

		return await tracer.startActiveSpan('process-request', async (span) => {
			// Logs include: request.id + trace.id + span.id
			requestLogger.info('Processing in span')

			span.end()
			return new Response('OK')
		})
	},
}
```

## Console Instrumentation (Opt-In)

Automatically emit logs for `console.log()`, `console.error()`, etc:

```typescript
logs: {
  transports: [...],
  instrumentation: {
    instrumentConsole: true, // Default: false
  },
}
```

**Note:** Console instrumentation can be high-volume. Consider using with sampling.

## Severity Levels

```typescript
import { SEVERITY_NUMBERS } from '@inference-net/otel-cf-workers'

SEVERITY_NUMBERS.TRACE // 1
SEVERITY_NUMBERS.DEBUG // 5
SEVERITY_NUMBERS.INFO // 9
SEVERITY_NUMBERS.WARN // 13
SEVERITY_NUMBERS.ERROR // 17
SEVERITY_NUMBERS.FATAL // 21
```

## Error Handling

The `error()` method has special handling for Error objects:

```typescript
try {
	throw new Error('Something failed')
} catch (error) {
	// Automatically extracts exception.type, exception.message, exception.stacktrace
	logger.error(error as Error, {
		context: 'additional data',
	})
}
```

## Examples

See the `examples/` directory for complete examples:

- `examples/logs-basic.ts` - Basic logging setup
- `examples/logs-advanced.ts` - Logs + traces with correlation
- `examples/logs-only.ts` - Logs without tracing
- `examples/logs-child-loggers.ts` - Child loggers with context inheritance

## Architecture

### Components

- **LoggerProvider**: Creates and manages loggers
- **Logger**: Emits log records with convenience methods
- **LogTransport**: Exports logs (OTLP, Console, custom)
- **LogRecordProcessor**: Batches and processes log records
- **LogRecord**: Individual log entry with trace context

### Flow

```
Logger.info()
  → LogRecord (with auto trace context)
  → LogRecordProcessor (batching)
  → LogTransport (export)
  → OTLP Backend
```

## Limitations

- No time-based batching (Cloudflare Workers constraint)
- Logs export in `ctx.waitUntil()` to avoid blocking responses
- Console instrumentation can be high-volume

## TypeScript Types

```typescript
import type {
	Logger,
	LoggerProvider,
	LogTransport,
	LogRecord,
	ReadableLogRecord,
	LogAttributes,
	SeverityNumber,
} from '@inference-net/otel-cf-workers'
```

## Migration from Traces-Only

### Before

```typescript
export default instrument(handler, {
	exporter: { url: '...' },
	service: { name: 'my-worker' },
})
```

### After (Backward Compatible)

```typescript
export default instrument(handler, {
	service: { name: 'my-worker' },
	trace: {
		exporter: { url: '...' },
	},
	logs: {
		transports: [new OTLPTransport({ url: '...' })],
	},
})
```

## Performance Considerations

1. **Batching**: Use `strategy: 'size'` with appropriate `maxQueueSize`
2. **Transports**: Multiple transports increase overhead
3. **Console Instrumentation**: High volume - use sparingly
4. **Async Export**: All exports happen in `ctx.waitUntil()` (non-blocking)

## Comparison with Official Cloudflare Logs

| Feature               | @inference-net/otel-cf-workers | Cloudflare Official |
| --------------------- | ------------------------------ | ------------------- |
| OTLP Export           | ✅ Yes                         | ✅ Yes              |
| Trace Correlation     | ✅ Automatic                   | ✅ Automatic        |
| Custom Transports     | ✅ Yes                         | ❌ No               |
| Multiple Destinations | ✅ Yes                         | ❌ No               |
| Console Transport     | ✅ Yes                         | ❌ No               |
| Batching Strategies   | ✅ Configurable                | ⚠️ Fixed            |

## Resources

- [OpenTelemetry Logs Specification](https://opentelemetry.io/docs/specs/otel/logs/)
- [OTLP Protocol](https://opentelemetry.io/docs/specs/otlp/)
- [Cloudflare Workers Observability](https://developers.cloudflare.com/workers/observability/)
