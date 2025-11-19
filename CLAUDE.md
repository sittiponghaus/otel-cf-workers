# CLAUDE.md - AI Assistant Context

## Package Overview

`@inference-net/otel-cf-workers` is an OpenTelemetry instrumentation library for **Cloudflare Workers**. This is a fork maintained by `@context-labs` (published as `@inference-net`), originally from `evanderkoogh/otel-cf-workers`.

**Current Version**: `1.0.0-rc.52`
**License**: BSD-3-Clause
**Repository**: https://github.com/context-labs/otel-cf-workers

## What This Library Does

1. **Auto-instrumentation** - Automatically traces Cloudflare Workers handlers and bindings without manual span creation
2. **Distributed Tracing** - Propagates W3C Trace Context headers across service boundaries
3. **OTLP Export** - Sends traces to OpenTelemetry-compatible backends (Honeycomb, Datadog, Grafana, etc.)
4. **Smart Sampling** - Head and tail sampling strategies to control trace volume and costs
5. **Context Propagation** - Maintains trace context across async boundaries in the Workers runtime

## Architecture

### Why Custom Implementation?

This library uses **custom tracer and span processor implementations** rather than the standard OpenTelemetry SDK because:

- **No Node.js Runtime**: Workers lack Node.js APIs that standard OTel SDK depends on
- **Unique Execution Model**: Workers have no persistent process; each request is isolated
- **Timing Constraints**: Workers don't expose accurate timing (Spectre protection)
- **Trace-Based Batching**: Exports complete traces at once rather than time-based batching

### Key Components

```
src/
├── sdk.ts              # Main instrument() and instrumentDO() functions
├── provider.ts         # WorkerTracerProvider (custom provider)
├── tracer.ts           # WorkerTracer (custom tracer implementation)
├── spanprocessor.ts    # BatchTraceSpanProcessor (trace-based batching)
├── exporter.ts         # OTLPExporter (OTLP/HTTP JSON)
├── config.ts           # Configuration parsing and management
├── sampling.ts         # Head and tail sampling logic
├── instrumentation/
│   ├── fetch.ts        # Global fetch + HTTP handler instrumentation
│   ├── kv.ts          # KV namespace operations
│   ├── d1.ts          # D1 database queries
│   ├── do.ts          # Durable Objects (fetch, alarm, storage)
│   ├── queue.ts       # Queue bindings
│   ├── cache.ts       # Cache API
│   ├── env.ts         # Binding detection and wrapping
│   └── ...
```

### Span Processing Flow

```
1. Handler invoked (fetch, scheduled, queue, etc.)
2. WorkerTracer creates spans
3. BatchTraceSpanProcessor groups spans by traceId
4. When all spans in trace complete → tail sampling decision
5. If sampled → export via OTLPExporter
6. Flush happens in ctx.waitUntil() to avoid blocking response
```

## OpenTelemetry Spec Coverage

### ✅ Implemented

#### Core APIs

- **Tracing API**: Full support (custom provider/tracer/span implementation)
- **Context Propagation**: W3C Trace Context (configurable propagators)
- **Semantic Conventions**: HTTP, Database, FaaS attributes
- **Span Processors**: Custom trace-based batch processor
- **Exporters**: OTLP/HTTP (JSON format)

#### Sampling

- **Head Sampling**: AlwaysOn, Ratio-based, custom Sampler support
- **Tail Sampling**: Function-based sampling at trace completion (unique feature)

#### Triggers (Entry Points)

- ✅ `handler.fetch` - HTTP requests
- ✅ `handler.scheduled` - Cron triggers
- ✅ `handler.queue` - Queue consumers
- ✅ `handler.email` - Email handlers
- ✅ Durable Object `fetch` method
- ✅ Durable Object `alarm` method
- ✅ `ctx.waitUntil` - Promise tracking

#### Globals/Built-ins

- ✅ Global `fetch()` - Outbound HTTP calls
- ✅ Cache API (`caches`) - Cache operations

#### Cloudflare Bindings

- ✅ **KV** - get, put, delete, list, getWithMetadata
- ✅ **Queue** - Producer send operations
- ✅ **Durable Objects** - Stub fetch calls
- ✅ **D1** - prepare, exec, batch, all, run, first, raw
- ✅ **Service Bindings** - Worker-to-worker calls
- ✅ **Analytics Engine** - writeDataPoint
- ✅ **Durable Object Storage** - get, put, delete, list, alarm methods

### ❌ Not Implemented

#### OpenTelemetry APIs

- ❌ **Metrics API** - Only tracing is supported
- ❌ **Logs API** - No structured logging
- ❌ **Baggage API** - Can be added via custom propagators

#### Triggers

- ❌ `handler.tail` - Tail consumers
- ❌ Durable Objects hibernated WebSocket handlers

#### Cloudflare Modules

- ❌ `cloudflare:email` module
- ❌ `cloudflare:sockets` module

#### Bindings

- ❌ **R2** - Object storage
- ❌ **Browser Rendering** - Puppeteer API
- ❌ **Workers AI** - AI model inference
- ❌ **Email Sending** - Outbound email
- ❌ **mTLS** - Mutual TLS bindings
- ❌ **Vectorize** - Vector database
- ❌ **Hyperdrive** - Database connection pooling
- ❌ **Workers for Platforms Dispatch** - Multi-tenant dispatch

## Important Limitations

### 1. Timing Accuracy ⚠️

**CRITICAL**: The Cloudflare Workers runtime does NOT expose accurate timing information to protect against Spectre/Meltdown side-channel attacks.

```typescript
// CPU-bound work will appear to take 0ms
const start = Date.now()
for (let i = 0; i < 1000000; i++) {
	/* heavy computation */
}
const duration = Date.now() - start // Often returns 0!
```

The clock only updates on I/O operations (fetch, KV reads, etc.). This is a **runtime limitation**, not a bug in this library.

**Impact**: Spans measuring pure CPU work will show inaccurate/zero duration.

### 2. RPC-Style Durable Object Calls

As of v1.0.0-rc.52, **RPC-style Durable Object method calls are NOT auto-instrumented**.

```typescript
// ❌ NOT instrumented (RPC style)
const result = await stub.someMethod(arg1, arg2)

// ✅ Instrumented (fetch style)
const response = await stub.fetch(request)
```

Classic `fetch()` calls to DOs work perfectly. Direct RPC method calls require manual instrumentation.

### 3. Build Requirements

- **ESM Only**: CommonJS support removed in v1.0.0-rc.52
- **Requires `nodejs_compat`**: Must add to `wrangler.toml`:
  ```toml
  compatibility_flags = ["nodejs_compat"]
  ```

### 4. Version Metadata

The library automatically detects Worker version metadata from the environment:

```typescript
// Automatically added to resource attributes:
'cf.worker.version.id': env.versionMetadata.id
'cf.worker.version.tag': env.versionMetadata.tag
'cf.worker.version.timestamp': env.versionMetadata.timestamp
```

## Usage Patterns

### Installation

```bash
yarn add @inference-net/otel-cf-workers @opentelemetry/api
```

### Basic Worker Instrumentation

```typescript
import { instrument, ResolveConfigFn } from '@inference-net/otel-cf-workers'
import { trace } from '@opentelemetry/api'

const handler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Auto-instrumented: fetch handler span created automatically

		// Manual attributes on active span
		trace.getActiveSpan()?.setAttribute('custom.attribute', 'value')

		// Auto-instrumented: fetch calls traced automatically
		const response = await fetch('https://api.example.com')

		return new Response('OK')
	},
}

const config: ResolveConfigFn = (env: Env) => {
	return {
		exporter: {
			url: 'https://api.honeycomb.io/v1/traces',
			headers: { 'x-honeycomb-team': env.HONEYCOMB_API_KEY },
		},
		service: { name: 'my-worker' },
	}
}

export default instrument(handler, config)
```

### Durable Object Instrumentation

```typescript
import { instrumentDO, ResolveConfigFn } from '@inference-net/otel-cf-workers'

class MyDurableObject implements DurableObject {
	async fetch(request: Request): Promise<Response> {
		// Auto-instrumented
		return new Response('Hello from DO!')
	}

	async alarm(): Promise<void> {
		// Auto-instrumented
	}
}

const config: ResolveConfigFn = (env, trigger) => ({
	exporter: { url: env.OTEL_ENDPOINT },
	service: { name: 'my-durable-object' },
})

export const MyDO = instrumentDO(MyDurableObject, config)
```

### Advanced Configuration

```typescript
const config: ResolveConfigFn = (env, trigger) => {
	return {
		exporter: {
			url: env.OTEL_ENDPOINT,
			headers: { Authorization: `Bearer ${env.API_KEY}` },
		},
		service: {
			name: 'my-service',
			version: '1.2.3',
			namespace: 'production',
		},

		// Head sampling: sample 10% of traces at start
		sampling: {
			headSampler: {
				ratio: 0.1,
				acceptRemote: true, // Accept parent trace decisions
			},
			// Tail sampling: always keep errors even if not head-sampled
			tailSampler: (trace) => {
				const rootSpan = trace.localRootSpan
				return (
					rootSpan.status.code === SpanStatusCode.ERROR ||
					(rootSpan.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0
				)
			},
		},

		// Control trace context propagation
		fetch: {
			includeTraceContext: (request) => {
				// Only propagate to same-origin requests
				return new URL(request.url).hostname === 'api.example.com'
			},
		},

		handlers: {
			fetch: {
				acceptTraceContext: (request) => {
					// Accept trace context from trusted origins
					return request.headers.get('x-trusted') === 'true'
				},
			},
		},

		// Redact sensitive data before export
		postProcessor: (spans) => {
			return spans.map((span) => {
				if (span.attributes['http.url']) {
					span.attributes['http.url'] = redactUrl(span.attributes['http.url'])
				}
				return span
			})
		},

		// Custom propagator
		propagator: new MyCustomPropagator(),

		// Disable global instrumentation if needed
		instrumentation: {
			instrumentGlobalFetch: true,
			instrumentGlobalCache: true,
		},
	}
}
```

## Configuration Types

### Service Config

```typescript
interface ServiceConfig {
	name: string // Required: service name
	version?: string // Optional: version (semver, git hash, etc.)
	namespace?: string // Optional: group services together
}
```

### Exporter Config

```typescript
// Simple OTLP config
interface OTLPExporterConfig {
	url: string
	headers?: Record<string, string>
}

// Or bring your own exporter
class CustomExporter implements SpanExporter {
	export(spans, callback) {
		/* ... */
	}
	shutdown() {
		/* ... */
	}
}
```

### Sampling Config

```typescript
interface SamplingConfig {
	headSampler?:
		| Sampler
		| {
				ratio: number // 0.0 to 1.0
				acceptRemote?: boolean // Accept parent trace decisions (default: true)
		  }
	tailSampler?: (trace: LocalTrace) => boolean
}
```

**Default Sampling Strategy**:

```typescript
// Head: Sample everything (ratio: 1.0)
// Tail: Keep head-sampled traces OR traces with errors
tailSampler: multiTailSampler([isHeadSampled, isRootErrorSpan])
```

## Instrumentation Details

### KV Operations

```typescript
// All operations auto-traced with attributes:
await env.MY_KV.get(key) // db.cf.kv.type, db.cf.kv.cache_ttl
await env.MY_KV.put(key, value) // db.cf.kv.expiration, db.cf.kv.metadata
await env.MY_KV.delete(key)
await env.MY_KV.list() // db.cf.kv.list_complete, db.cf.kv.cursor
await env.MY_KV.getWithMetadata() // db.cf.kv.cache_status
```

### D1 Queries

```typescript
// All operations traced with SQL statements:
const stmt = env.DB.prepare('SELECT * FROM users WHERE id = ?')
await stmt.bind(123).first() // db.statement, db.cf.d1.rows_read
await stmt.all() // db.cf.d1.duration, db.cf.d1.changes

// Batch queries create sub-spans:
await env.DB.batch([stmt1, stmt2, stmt3]) // Parent + 3 child spans
```

### Durable Object Storage

```typescript
// Inside a Durable Object:
await this.ctx.storage.get(key)
await this.ctx.storage.put(key, value)
await this.ctx.storage.delete(key)
await this.ctx.storage.list()
await this.ctx.storage.setAlarm(Date.now() + 60000)
```

### Manual Span Creation

```typescript
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('my-tracer')

await tracer.startActiveSpan('operation-name', async (span) => {
	span.setAttribute('custom.key', 'value')

	try {
		const result = await doWork()
		span.setStatus({ code: SpanStatusCode.OK })
		return result
	} catch (error) {
		span.recordException(error)
		span.setStatus({ code: SpanStatusCode.ERROR })
		throw error
	} finally {
		span.end()
	}
})
```

## Common Issues & Solutions

### Issue: Spans not exported

**Cause**: Export happens in `ctx.waitUntil()`. If the execution context ends before export completes, spans are lost.

**Solution**: The library handles this automatically, but ensure you're not manually ending the execution context prematurely.

### Issue: Duplicate spans

**Cause**: Both global fetch instrumentation and manual instrumentation active.

**Solution**: Disable global instrumentation if manually instrumenting:

```typescript
instrumentation: {
	instrumentGlobalFetch: false
}
```

### Issue: RPC calls not traced

**Cause**: RPC-style Durable Object calls aren't auto-instrumented yet.

**Solution**: Use fetch-style calls or add manual spans:

```typescript
// Manual workaround:
await tracer.startActiveSpan('DO RPC call', async (span) => {
	const result = await stub.rpcMethod(args)
	span.end()
	return result
})
```

### Issue: Sensitive data in spans

**Cause**: URLs, headers, etc. captured automatically.

**Solution**: Use `postProcessor` to redact:

```typescript
postProcessor: (spans) => {
	return spans.map((span) => {
		// Redact URLs with tokens
		if (span.attributes['http.url']) {
			span.attributes['http.url'] = span.attributes['http.url'].replace(/token=[^&]+/, 'token=REDACTED')
		}
		// Remove sensitive headers
		delete span.attributes['http.request.header.authorization']
		return span
	})
}
```

## Version History Highlights

### v1.0.0-rc.52 (Current)

- ❌ **BREAKING**: Removed CommonJS support (ESM only)
- ✅ Proper class-style Durable Objects support
- ✅ Force-end unfinished spans on flush
- ⚠️ RPC-style DO calls still not auto-instrumented

### v1.0.0-rc.50

- Complete internal rework for better predictability

### v1.0.0-rc.48

- Initial D1 support (experimental)

### v1.0.0-rc.15

- Scheduled handler instrumentation
- Analytics Engine binding support
- Updated HTTP semantic conventions

## Testing

The library uses Vitest with `@cloudflare/vitest-pool-workers` for testing:

```bash
yarn test      # Run tests once
yarn test:dev  # Watch mode
```

Tests run in a simulated Workers environment to ensure compatibility.

## Development Commands

```bash
yarn build          # Build library (tsup + version metadata)
yarn clean          # Remove build artifacts
yarn format         # Format code with Prettier
yarn check          # Run all checks (types + format)
yarn check:types    # TypeScript type checking
yarn watch          # Watch mode for development
yarn ci             # Full CI workflow (clean + build + check)
```

## When to Use This Library

### ✅ Good Fit

- Cloudflare Workers applications needing observability
- Distributed tracing across Workers, Durable Objects, and external services
- Debugging performance issues (with timing caveats)
- Monitoring error rates and patterns
- Integration with existing OTel infrastructure

### ❌ Not a Good Fit

- Accurate CPU timing measurement (runtime limitation)
- Metrics/logs collection (traces only)
- Applications using R2, AI, Vectorize heavily (not instrumented yet)
- CommonJS projects (ESM only as of v1.0.0-rc.52)

## Contributing Guidelines

When adding new instrumentation:

1. **Follow the pattern**: See `src/instrumentation/` for examples
2. **Use `wrap()` utility**: From `src/wrap.ts` for proxying
3. **Semantic conventions**: Use `@opentelemetry/semantic-conventions`
4. **Handle errors**: Always `recordException()` and set error status
5. **Test in Workers env**: Use vitest-pool-workers

## Additional Resources

- [Main README](./README.md) - User-facing documentation
- [Examples](./examples/) - Working code samples
- [OpenTelemetry JS Docs](https://opentelemetry.io/docs/languages/js/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
