import { sdk } from './sdk'

// Projects, renders and the CLI home live in `main`. Caches rebuild
// themselves (browser profiles, extracted frames, downloaded models), so
// they are left out of the backup.
export const { createBackup, restoreInit } = sdk.setupBackups(
  async ({ effects }) =>
    sdk.Backups.ofVolumes('main').setOptions({
      exclude: ['home/.cache', 'home/.npm', 'tmp'],
    }),
)
