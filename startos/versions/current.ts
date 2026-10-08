import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.135:4',
  releaseNotes: {
    en_US:
      "HeyGen's three agent skills (heygen-avatar, heygen-video, heygen-translate) are served to agents as a fourth skills tree, with CLI feedback reporting off by default and no API key handling in chat. Skill descriptions written as literal YAML blocks now show correctly in list_skills. All eight community skills are now served once, including day-in-my-life and session-story with explicit history-consent and private local-execution instructions.",
    es_ES:
      'Las tres habilidades de agente de HeyGen (heygen-avatar, heygen-video, heygen-translate) se sirven a los agentes como un cuarto árbol de habilidades, con el envío de comentarios de la CLI desactivado por defecto y sin manejo de claves API en el chat. Las descripciones de habilidades escritas como bloques YAML literales ahora se muestran correctamente en list_skills. Las ocho habilidades comunitarias se sirven una sola vez, incluidas day-in-my-life y session-story con consentimiento explícito para el historial e instrucciones de ejecución local privada.',
    de_DE:
      'Die drei Agenten-Skills von HeyGen (heygen-avatar, heygen-video, heygen-translate) werden Agenten als vierter Skills-Baum bereitgestellt, wobei die CLI-Feedback-Meldung standardmäßig aus ist und keine API-Schlüssel im Chat verarbeitet werden. Skill-Beschreibungen als literale YAML-Blöcke werden jetzt in list_skills korrekt angezeigt. Alle acht Community-Skills werden jeweils einmal bereitgestellt, einschließlich day-in-my-life und session-story mit ausdrücklicher Zustimmung zum Verlauf und Anweisungen für private lokale Ausführung.',
    pl_PL:
      'Trzy umiejętności agenta HeyGen (heygen-avatar, heygen-video, heygen-translate) są udostępniane agentom jako czwarte drzewo umiejętności, z domyślnie wyłączonym raportowaniem opinii CLI i bez obsługi kluczy API w czacie. Opisy umiejętności zapisane jako dosłowne bloki YAML są teraz poprawnie wyświetlane w list_skills. Wszystkie osiem umiejętności społeczności jest udostępnianych bez duplikatów, w tym day-in-my-life i session-story z wyraźną zgodą na użycie historii i instrukcjami prywatnego wykonania lokalnego.',
    fr_FR:
      "Les trois compétences d'agent de HeyGen (heygen-avatar, heygen-video, heygen-translate) sont servies aux agents comme un quatrième arbre de compétences, avec l'envoi de retours CLI désactivé par défaut et aucune manipulation de clé API dans le chat. Les descriptions de compétences écrites en blocs YAML littéraux s'affichent désormais correctement dans list_skills. Les huit compétences communautaires sont servies sans doublons, dont day-in-my-life et session-story avec consentement explicite pour l’historique et consignes d’exécution locale privée.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
