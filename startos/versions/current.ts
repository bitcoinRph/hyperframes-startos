import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.185:3',
  releaseNotes: {
    en_US:
      'Security update for the agent API and MCP server: hono 4.13.23 and @hono/node-server 2.1.11 fix published advisories. HyperFrames stays at 0.8.185. Projects, credentials and backups are unchanged.',
    es_ES:
      'Actualización de seguridad del servidor API y MCP: hono 4.13.23 y @hono/node-server 2.1.11 corrigen avisos publicados. HyperFrames sigue en 0.8.185. Proyectos, credenciales y copias de seguridad sin cambios.',
    de_DE:
      'Sicherheitsupdate für den API- und MCP-Server: hono 4.13.23 und @hono/node-server 2.1.11 beheben veröffentlichte Sicherheitshinweise. HyperFrames bleibt bei 0.8.185. Projekte, Zugangsdaten und Backups bleiben unverändert.',
    pl_PL:
      'Aktualizacja bezpieczeństwa serwera API i MCP: hono 4.13.23 i @hono/node-server 2.1.11 naprawiają opublikowane luki. HyperFrames pozostaje w wersji 0.8.185. Projekty, dane logowania i kopie zapasowe bez zmian.',
    fr_FR:
      'Mise à jour de sécurité du serveur API et MCP : hono 4.13.23 et @hono/node-server 2.1.11 corrigent des avis publiés. HyperFrames reste en 0.8.185. Projets, identifiants et sauvegardes inchangés.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
