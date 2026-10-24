import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.185:1',
  releaseNotes: {
    en_US:
      'HyperFrames 0.8.185 (from 0.8.162). Official skills are consolidated into seven complete version-matched trees: read hyperframes first for the render contract and workflow references. Adds scoped check and snapshot review controls through REST and MCP, with optional provider image descriptions disabled by default. Includes upstream capture motion blur, render/audio and browser reliability fixes. Pins the amd64 headless browser and fixes native arm64 browser selection. Existing projects, credentials and backup layout are unchanged. Hosted providers remain optional and require separately configured keys; local rendering requires no account. Also updates the agent API and MCP server dependencies (zod 4.6.7, MCP SDK 1.32.2, body-parser 2.4.0) to fix published security advisories.',
    es_ES:
      'HyperFrames 0.8.185: siete árboles oficiales completos de habilidades; consulte hyperframes primero. Controles de check y snapshot por REST/MCP, descripciones del proveedor desactivadas por defecto. Correcciones de renderizado, audio y navegador. Proyectos, credenciales y copias sin cambios; proveedores alojados opcionales. También actualiza las dependencias del servidor API y MCP (zod 4.6.7, MCP SDK 1.32.2, body-parser 2.4.0) para corregir avisos de seguridad.',
    de_DE:
      'HyperFrames 0.8.185: sieben vollständige offizielle Skill-Bäume; zuerst hyperframes lesen. Check- und Snapshot-Steuerung über REST/MCP, Anbieter-Bildbeschreibungen standardmäßig aus. Render-, Audio- und Browserkorrekturen. Projekte, Zugangsdaten und Backups unverändert; gehostete Anbieter optional. Aktualisiert außerdem die Abhängigkeiten des API- und MCP-Servers (zod 4.6.7, MCP SDK 1.32.2, body-parser 2.4.0) gegen veröffentlichte Sicherheitshinweise.',
    pl_PL:
      'HyperFrames 0.8.185: siedem pełnych oficjalnych drzew umiejętności; najpierw hyperframes. Kontrola check i snapshot przez REST/MCP, opisy dostawcy domyślnie wyłączone. Poprawki renderowania, dźwięku i przeglądarki. Projekty, dane logowania i kopie bez zmian; dostawcy chmurowi opcjonalni. Aktualizuje też zależności serwera API i MCP (zod 4.6.7, MCP SDK 1.32.2, body-parser 2.4.0), aby usunąć opublikowane luki bezpieczeństwa.',
    fr_FR:
      'HyperFrames 0.8.185 : sept arborescences officielles complètes ; lire hyperframes en premier. Contrôles check et snapshot via REST/MCP, descriptions du fournisseur désactivées par défaut. Corrections de rendu, audio et navigateur. Projets, identifiants et sauvegardes inchangés ; fournisseurs hébergés facultatifs. Met aussi à jour les dépendances du serveur API et MCP (zod 4.6.7, MCP SDK 1.32.2, body-parser 2.4.0) pour corriger des avis de sécurité publiés.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
