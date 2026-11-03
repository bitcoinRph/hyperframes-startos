import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.185:3',
  releaseNotes: {
    en_US:
      'Optional VoiceStudio integration. When VoiceStudio is installed on the same server, agents get voicestudio_* tools (MCP and REST) for narration, transcription with word timings, voice cloning, voice design and dubbing with local translation. The audio is saved straight into the project. HyperFrames is unchanged without VoiceStudio.',
    es_ES:
      'Integración opcional con VoiceStudio. Si VoiceStudio está instalado en el mismo servidor, los agentes obtienen herramientas voicestudio_* (MCP y REST) para narración, transcripción con tiempos por palabra, clonación y diseño de voz, y doblaje con traducción local. El audio se guarda directamente en el proyecto. Sin VoiceStudio, HyperFrames no cambia.',
    de_DE:
      'Optionale VoiceStudio-Integration. Ist VoiceStudio auf demselben Server installiert, erhalten Agenten voicestudio_*-Werkzeuge (MCP und REST) für Sprecherstimme, Transkription mit Wortzeiten, Stimmklonung, Stimmdesign und Synchronisation mit lokaler Übersetzung. Das Audio wird direkt im Projekt gespeichert. Ohne VoiceStudio bleibt HyperFrames unverändert.',
    pl_PL:
      'Opcjonalna integracja z VoiceStudio. Gdy VoiceStudio jest zainstalowane na tym samym serwerze, agenci otrzymują narzędzia voicestudio_* (MCP i REST) do narracji, transkrypcji z czasami słów, klonowania i projektowania głosu oraz dubbingu z lokalnym tłumaczeniem. Dźwięk zapisuje się bezpośrednio w projekcie. Bez VoiceStudio HyperFrames działa bez zmian.',
    fr_FR:
      "Intégration facultative de VoiceStudio. Si VoiceStudio est installé sur le même serveur, les agents disposent des outils voicestudio_* (MCP et REST) pour la narration, la transcription avec horodatage des mots, le clonage et la conception de voix, et le doublage avec traduction locale. L'audio est enregistré directement dans le projet. Sans VoiceStudio, HyperFrames ne change pas.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
