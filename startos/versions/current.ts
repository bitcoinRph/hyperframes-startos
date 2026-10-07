import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.8.135:2',
  releaseNotes: {
    en_US:
      'Catalog and launch references for agents: catalog_item reads a registry item’s variables before install, catalog_add bakes variable values into the snippet (vars), import_project copies a HeyGen launch film or re-brandable template from GitHub (LFS media included) into a project, and a new hyperframes-launch-references skill explains how to study and re-brand them.',
    es_ES:
      'Catálogo y referencias de lanzamiento para agentes: catalog_item lee las variables de un elemento del registro antes de instalarlo, catalog_add incorpora valores de variables en el fragmento (vars), import_project copia una película de lanzamiento de HeyGen o una plantilla rebrandeable desde GitHub (incluidos los medios LFS) a un proyecto, y una nueva habilidad hyperframes-launch-references explica cómo estudiarlas y rebrandearlas.',
    de_DE:
      'Katalog und Launch-Referenzen für Agenten: catalog_item liest die Variablen eines Registry-Elements vor der Installation, catalog_add schreibt Variablenwerte in das Snippet (vars), import_project kopiert einen HeyGen-Launch-Film oder eine umbrandbare Vorlage von GitHub (inklusive LFS-Medien) in ein Projekt, und ein neuer Skill hyperframes-launch-references erklärt, wie man sie studiert und umbrandet.',
    pl_PL:
      'Katalog i materiały referencyjne launchy dla agentów: catalog_item odczytuje zmienne elementu rejestru przed instalacją, catalog_add wstawia wartości zmiennych do fragmentu (vars), import_project kopiuje film launchowy HeyGen lub szablon do rebrandingu z GitHub (wraz z mediami LFS) do projektu, a nowa umiejętność hyperframes-launch-references wyjaśnia, jak je studiować i rebrandować.',
    fr_FR:
      'Catalogue et références de lancement pour les agents : catalog_item lit les variables d’un élément du registre avant l’installation, catalog_add intègre les valeurs des variables dans l’extrait (vars), import_project copie un film de lancement HeyGen ou un modèle rebrandable depuis GitHub (médias LFS inclus) dans un projet, et une nouvelle compétence hyperframes-launch-references explique comment les étudier et les rebrander.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
