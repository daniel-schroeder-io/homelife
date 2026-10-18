const server = Bun.spawn(['bun', '--hot', 'server/index.ts'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
})

const client = Bun.spawn(['bun', 'x', 'vite'], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
})

function shutdown() {
  server.kill()
  client.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.all([server.exited, client.exited])
