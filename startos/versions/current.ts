import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.135:3',
  releaseNotes: {
    en_US:
      'Studio works on a phone: under 600 px the preview and timeline take the full width, the header wraps so Export is reachable, and a bottom bar switches between Preview, Timeline and the panel menu. Six HyperFrames community skills (vox-explainer, camera-3d-captions, duo, p5-paint-animation, prod-by-claude, x-posting-license) are served to agents alongside the upstream and StartOS skills.',
    es_ES:
      'Studio funciona en el teléfono: por debajo de 600 px la vista previa y la línea de tiempo ocupan todo el ancho, la cabecera se ajusta para que Exportar quede accesible y una barra inferior alterna entre Vista previa, Línea de tiempo y el menú de paneles. Seis habilidades de la comunidad HyperFrames (vox-explainer, camera-3d-captions, duo, p5-paint-animation, prod-by-claude, x-posting-license) se sirven a los agentes junto con las habilidades upstream y de StartOS.',
    de_DE:
      'Studio funktioniert auf dem Telefon: unter 600 px nehmen Vorschau und Zeitleiste die volle Breite ein, die Kopfzeile bricht um, damit Export erreichbar bleibt, und eine untere Leiste wechselt zwischen Vorschau, Zeitleiste und dem Panel-Menü. Sechs HyperFrames-Community-Skills (vox-explainer, camera-3d-captions, duo, p5-paint-animation, prod-by-claude, x-posting-license) werden Agenten neben den Upstream- und StartOS-Skills bereitgestellt.',
    pl_PL:
      'Studio działa na telefonie: poniżej 600 px podgląd i oś czasu zajmują całą szerokość, nagłówek zawija się, aby przycisk Eksport był dostępny, a dolny pasek przełącza między Podglądem, Osią czasu i menu paneli. Sześć umiejętności społeczności HyperFrames (vox-explainer, camera-3d-captions, duo, p5-paint-animation, prod-by-claude, x-posting-license) jest udostępnianych agentom obok umiejętności upstream i StartOS.',
    fr_FR:
      'Studio fonctionne sur téléphone : sous 600 px, l’aperçu et la timeline occupent toute la largeur, l’en-tête passe à la ligne pour que Exporter reste accessible, et une barre en bas bascule entre Aperçu, Timeline et le menu des panneaux. Six compétences communautaires HyperFrames (vox-explainer, camera-3d-captions, duo, p5-paint-animation, prod-by-claude, x-posting-license) sont servies aux agents avec les compétences upstream et StartOS.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
