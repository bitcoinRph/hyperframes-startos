import { readdir, stat } from 'node:fs/promises'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { studioJson } from '../fileModels/studio.json'
import { projectsSubpath } from '../utils'

const { InputSpec, Value } = sdk

// A project is a directory under projects/ with an index.html composition.
async function listProjects(): Promise<string[]> {
  const root = sdk.volumes.main.subpath(projectsSubpath)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const hasIndex = await stat(`${root}/${entry.name}/index.html`)
      .then((s) => s.isFile())
      .catch(() => false)
    if (hasIndex) names.push(entry.name)
  }
  return names.sort()
}

export const inputSpec = InputSpec.of({
  project: Value.dynamicSelect(async () => {
    const projects = await listProjects()
    const current = (await studioJson.read((s) => s.project).once()) ?? ''
    const values = Object.fromEntries(projects.map((p) => [p, p]))
    return {
      name: i18n('Project'),
      description: i18n(
        'Studio shows one project at a time. Agents can also switch it through the API.',
      ),
      default: projects.includes(current) ? current : (projects[0] ?? ''),
      values,
      disabled: projects.length
        ? false
        : i18n(
            'No projects yet. Create one with the agent API or wait for the welcome project.',
          ),
    }
  }),
})

export const openStudioProject = sdk.Action.withInput(
  'open-studio-project',

  async () => ({
    name: i18n('Open Project in Studio'),
    description: i18n(
      'Choose which project the Studio interface serves. Only Studio restarts.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => ({
    project: (await studioJson.read((s) => s.project).once()) ?? '',
  }),

  async ({ effects, input }) =>
    studioJson.merge(effects, { project: input.project }),
)
