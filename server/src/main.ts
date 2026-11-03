import { mkdir } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { createApp } from './api.js'
import { config } from './config.js'
import { loadJobs } from './jobs.js'
import { loadDubJobs } from './voicestudio.js'

async function main(): Promise<void> {
  await mkdir(config.projectsDir, { recursive: true })
  await mkdir(config.stateDir, { recursive: true })
  await loadJobs()
  await loadDubJobs()
  const app = createApp()
  serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    console.log(
      `hyperframes-startos server ${config.version} listening on :${info.port} (projects: ${config.projectsDir}, mcp: ${config.mcpPath}, api key ${config.apiKey ? 'set' : 'NOT SET'})`,
    )
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
