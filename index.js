import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const appsDir = path.join(root, 'apps')
const apps = {}

for (const file of fs.readdirSync(appsDir).filter(name => name.endsWith('.js'))) {
  const mod = await import(pathToFileURL(path.join(appsDir, file)).href)
  for (const [name, value] of Object.entries(mod)) apps[name] = value
}

export { apps }
