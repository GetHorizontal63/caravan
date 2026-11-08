import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { config, paths } from './config.ts'
import './db.ts'
import publicRoutes, { VERSION } from './routes/public.ts'
import bookRoutes from './routes/books.ts'
import adminRoutes from './routes/admin.ts'
import opdsRoutes from './routes/opds.ts'
import collectionRoutes from './routes/collections.ts'
import backgroundRoutes from './routes/backgrounds.ts'
import seriesRoutes from './routes/series.ts'
import { startScheduler, scanAll } from './scanner.ts'

const app = Fastify({
  logger: {
    level: process.env.CARAVAN_LOG_LEVEL ?? process.env.JR_LOG_LEVEL ?? 'info',
    transport: undefined,
    serializers: {
      // covers/downloads carry the session token as ?api_key= (img tags can't send headers); keep it out of the logs
      req: (req: { method: string; url: string; host?: string; ip?: string; socket?: { remotePort?: number } }) => ({
        method: req.method,
        url: req.url.replace(/([?&](?:api_key|token)=)[^&]*/gi, '$1[redacted]'),
        host: req.host,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort,
      }),
    },
  },
  bodyLimit: 10 * 1024 * 1024,
  trustProxy: true,
})

// Native apps (Android/desktop) talk to the server cross-origin with bearer tokens — no cookies — so a permissive CORS policy is safe.
await app.register(cors, { origin: true, exposedHeaders: ['X-Book-Format', 'Content-Length'] })
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 50 } })

await app.register(publicRoutes)
await app.register(bookRoutes)
await app.register(adminRoutes)
await app.register(opdsRoutes)
await app.register(collectionRoutes)
await app.register(backgroundRoutes)
await app.register(seriesRoutes)

app.setErrorHandler((error, req, reply) => {
  const err = error as Error & { statusCode?: number }
  const status = err.statusCode ?? 500
  if (status >= 500) req.log.error(err)
  reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message })
})

// ---- web client --------------------------------------------------------------
if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: config.webDir,
    // look files up per request, so rebuilding the web client doesn't require a server restart
    wildcard: true,
    setHeaders(res, file) {
      // hashed assets are immutable; index.html must always revalidate
      res.header('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  })
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/opds') || req.url.startsWith('/assets/')) return reply.code(404).send({ error: 'Not found' })
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
  })
} else {
  app.log.warn(`Web client not found at ${config.webDir} — run "npm run build" in /web. API is still available.`)
}

await app.listen({ port: config.port, host: config.host })
app.log.info(`Caravan ${VERSION} — data in ${config.dataDir} (db ${path.basename(paths.db)})`)

startScheduler()
if ((process.env.CARAVAN_SCAN_ON_START ?? process.env.JR_SCAN_ON_START) !== '0') void scanAll()

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close()
    process.exit(0)
  })
}
