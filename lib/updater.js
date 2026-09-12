import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function run(command, args, cwd) {
  const { stdout = '', stderr = '' } = await execFileAsync(command, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

export function selectRemote(remotes, configured) {
  if (configured && configured !== '.' && remotes.includes(configured)) return configured
  return ['origin', 'gitee', 'github'].find(name => remotes.includes(name)) ?? remotes[0] ?? null
}

export class PluginUpdater {
  constructor({ pluginRoot, logger = console, runner = run }) {
    this.pluginRoot = pluginRoot
    this.yunzaiRoot = path.resolve(pluginRoot, '..', '..')
    this.logger = logger
    this.runner = runner
    this.running = false
  }

  async git(...args) { return this.runner('git', args, this.pluginRoot) }

  async repository() {
    if ((await this.git('rev-parse', '--is-inside-work-tree')).stdout !== 'true') throw new Error('插件目录不是 Git 仓库，请使用 Git 安装后再执行更新')
    const branch = (await this.git('branch', '--show-current')).stdout || 'main'
    const remotes = (await this.git('remote')).stdout.split(/\r?\n/).filter(Boolean)
    let configured = ''
    try { configured = (await this.git('config', '--get', `branch.${branch}.remote`)).stdout } catch {}
    const remote = selectRemote(remotes, configured)
    if (!remote) throw new Error('没有可用的 Git 远端')
    return { branch, remote }
  }

  async backupPatch() {
    const patchText = (await this.git('diff', 'HEAD')).stdout
    if (!patchText) return null
    const backupDir = path.join(this.pluginRoot, 'data', 'update-backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = path.join(backupDir, `${stamp}.patch`)
    fs.writeFileSync(filename, `${patchText}\n`, 'utf8')
    return filename
  }

  async installDependencies() {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    return this.runner(command, ['install', '--filter=threadscout-plugin'], this.yunzaiRoot)
  }

  async update({ force = false } = {}) {
    if (this.running) return { status: 'locked' }
    this.running = true
    try {
      const { branch, remote } = await this.repository()
      const dirty = Boolean((await this.git('status', '--porcelain', '--untracked-files=no')).stdout)
      if (dirty && !force) return { status: 'dirty', remote, branch }
      const backup = force ? await this.backupPatch() : null
      await this.git('fetch', '--prune', remote, branch)
      const before = (await this.git('rev-parse', 'HEAD')).stdout
      const target = `${remote}/${branch}`
      const after = (await this.git('rev-parse', target)).stdout
      if (before === after && !dirty) return { status: 'up-to-date', remote, branch, before, after }
      if (force) await this.git('reset', '--hard', target)
      else await this.git('merge', '--ff-only', target)
      const installed = await this.installDependencies()
      return { status: 'updated', remote, branch, before, after, backup, installOutput: installed.stdout || installed.stderr }
    } finally { this.running = false }
  }
}
