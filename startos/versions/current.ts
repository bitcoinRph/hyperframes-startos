import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.135:1',
  releaseNotes: {
    en_US:
      'Hardening: fetch_asset downloads only from public hosts (loopback, LAN, link-local and .local targets are refused, redirects included) and streams with a size limit; run_cli upgrade is limited to --check and --project; CI runs typecheck, lint, formatting, server tests and the server dependency audit before every build.',
    es_ES:
      'Refuerzo de seguridad: fetch_asset solo descarga desde hosts públicos (se rechazan destinos loopback, LAN, link-local y .local, incluidas las redirecciones) y transmite con un límite de tamaño; run_cli upgrade se limita a --check y --project; la CI ejecuta la comprobación de tipos, el lint, el formato, las pruebas del servidor y la auditoría de dependencias del servidor antes de cada compilación.',
    de_DE:
      'Härtung: fetch_asset lädt nur von öffentlichen Hosts (Loopback-, LAN-, Link-local- und .local-Ziele werden abgelehnt, auch bei Weiterleitungen) und streamt mit Größenlimit; run_cli upgrade ist auf --check und --project beschränkt; die CI führt vor jedem Build Typprüfung, Lint, Formatierung, Server-Tests und das Abhängigkeits-Audit des Servers aus.',
    pl_PL:
      'Wzmocnienie bezpieczeństwa: fetch_asset pobiera tylko z hostów publicznych (cele loopback, LAN, link-local i .local są odrzucane, także po przekierowaniach) i strumieniuje z limitem rozmiaru; run_cli upgrade jest ograniczone do --check i --project; CI uruchamia sprawdzanie typów, lint, formatowanie, testy serwera i audyt zależności serwera przed każdą kompilacją.',
    fr_FR:
      'Renforcement : fetch_asset ne télécharge que depuis des hôtes publics (les cibles loopback, LAN, link-local et .local sont refusées, redirections comprises) et diffuse avec une limite de taille ; run_cli upgrade est limité à --check et --project ; la CI exécute la vérification des types, le lint, le formatage, les tests du serveur et l’audit des dépendances du serveur avant chaque build.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
