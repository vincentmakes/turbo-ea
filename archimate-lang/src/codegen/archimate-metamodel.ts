/**
 * ArchiMate 3.2 metamodel definitions — generated from the Langium grammar.
 * Grammar specification derived from bigArchiMate by borkdominik
 * (https://github.com/borkdominik/bigArchiMate) — MIT License
 *
 * This file is the build-time source of truth for:
 *   - Backend seed.py (card types + relation types)
 *   - Frontend shape library (node metadata, colors, icons)
 *   - Frontend valid-relation matrix (edge drawing rules)
 */

export type ArchiMateLayer =
  | "Business"
  | "Application"
  | "Technology"
  | "Motivation"
  | "Strategy"
  | "Implementation"
  | "Physical"
  | "Composite";

export type ArchiMateAspect =
  | "active_structure"
  | "behavior"
  | "passive_structure"
  | "motivation"
  | "composite";

export interface Translations {
  label: Record<string, string>;
  description?: Record<string, string>;
}

export interface ArchimateElementDef {
  /** Turbo EA card type key — prefixed 'arch_' */
  key: string;
  /** English label */
  label: string;
  /** ArchiMate grammar type name (from Langium grammar) */
  grammarType: string;
  /** EA layer */
  layer: ArchiMateLayer;
  /** ArchiMate aspect within the layer */
  aspect: ArchiMateAspect;
  /** Card category (prefixed 'ArchiMate:') */
  category: string;
  /** Material Symbol icon name */
  icon: string;
  /** Hex color based on layer */
  defaultColor: string;
  defaultWidth: number;
  defaultHeight: number;
  translations: Translations;
}

export interface ArchimateRelationDef {
  /** Turbo EA relation type key — prefixed 'arch_rel_' */
  key: string;
  /** ArchiMate grammar relation name */
  grammarType: string;
  label: string;
  reverseLabel: string;
  /** ArchiMate line style */
  lineStyle: "solid" | "dashed";
  /** Source marker */
  sourceMarker: "none" | "filled_diamond" | "hollow_diamond" | "filled_circle" | "hollow_circle";
  /** Target marker */
  targetMarker: "none" | "open_arrow" | "filled_arrow" | "hollow_arrow" | "hollow_triangle";
  translations: Translations;
}

export interface ArchimateLayerMeta {
  label: string;
  color: string;
  sortOrder: number;
}

// ── Layer colors (ArchiMate 3.2 specification) ──────────────────────────────

export const ARCHIMATE_LAYER_META: Record<ArchiMateLayer, ArchimateLayerMeta> = {
  Business:       { label: "Business Layer",               color: "#f5e27a", sortOrder: 1 },
  Application:    { label: "Application Layer",            color: "#b3d9ff", sortOrder: 2 },
  Technology:     { label: "Technology Layer",             color: "#aae6aa", sortOrder: 3 },
  Motivation:     { label: "Motivation",                   color: "#ffcca8", sortOrder: 4 },
  Strategy:       { label: "Strategy",                     color: "#d9b3ff", sortOrder: 5 },
  Implementation: { label: "Implementation & Migration",   color: "#e0e0e0", sortOrder: 6 },
  Physical:       { label: "Physical",                     color: "#c8e6c9", sortOrder: 7 },
  Composite:      { label: "Composite",                    color: "#ffffff", sortOrder: 8 },
};

// ── Helper to get category string ──────────────────────────────────────────

const cat = (layer: ArchiMateLayer) => `ArchiMate: ${ARCHIMATE_LAYER_META[layer].label}`;
const col = (layer: ArchiMateLayer) => ARCHIMATE_LAYER_META[layer].color;

// ── Element Definitions ─────────────────────────────────────────────────────

export const ARCHIMATE_ELEMENT_DEFS: ArchimateElementDef[] = [
  // ── Business Layer — Active Structure (4) ──────────────────────────────
  {
    key: "arch_BusinessActor", grammarType: "BusinessActor",
    label: "Business Actor", layer: "Business", aspect: "active_structure",
    category: cat("Business"), icon: "person", defaultColor: col("Business"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Geschäftsakteur", fr: "Acteur métier", es: "Actor de negocio", it: "Attore business", pt: "Ator de negócio", zh: "业务角色者", ru: "Бизнес-актор" } },
  },
  {
    key: "arch_BusinessRole", grammarType: "BusinessRole",
    label: "Business Role", layer: "Business", aspect: "active_structure",
    category: cat("Business"), icon: "badge", defaultColor: col("Business"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Geschäftsrolle", fr: "Rôle métier", es: "Rol de negocio", it: "Ruolo business", pt: "Papel de negócio", zh: "业务角色", ru: "Бизнес-роль" } },
  },
  {
    key: "arch_BusinessCollaboration", grammarType: "BusinessCollaboration",
    label: "Business Collaboration", layer: "Business", aspect: "active_structure",
    category: cat("Business"), icon: "groups", defaultColor: col("Business"),
    defaultWidth: 140, defaultHeight: 55,
    translations: { label: { de: "Geschäftskollaboration", fr: "Collaboration métier", es: "Colaboración de negocio", it: "Collaborazione business", pt: "Colaboração de negócio", zh: "业务协作", ru: "Бизнес-коллаборация" } },
  },
  {
    key: "arch_BusinessInterface", grammarType: "BusinessInterface",
    label: "Business Interface", layer: "Business", aspect: "active_structure",
    category: cat("Business"), icon: "settings_input_component", defaultColor: col("Business"),
    defaultWidth: 130, defaultHeight: 55,
    translations: { label: { de: "Geschäftsschnittstelle", fr: "Interface métier", es: "Interfaz de negocio", it: "Interfaccia business", pt: "Interface de negócio", zh: "业务接口", ru: "Бизнес-интерфейс" } },
  },
  // ── Business Layer — Behavior (5) ──────────────────────────────────────
  {
    key: "arch_BusinessProcess", grammarType: "BusinessProcess",
    label: "Business Process", layer: "Business", aspect: "behavior",
    category: cat("Business"), icon: "route", defaultColor: col("Business"),
    defaultWidth: 130, defaultHeight: 55,
    translations: { label: { de: "Geschäftsprozess", fr: "Processus métier", es: "Proceso de negocio", it: "Processo business", pt: "Processo de negócio", zh: "业务流程", ru: "Бизнес-процесс" } },
  },
  {
    key: "arch_BusinessFunction", grammarType: "BusinessFunction",
    label: "Business Function", layer: "Business", aspect: "behavior",
    category: cat("Business"), icon: "functions", defaultColor: col("Business"),
    defaultWidth: 130, defaultHeight: 55,
    translations: { label: { de: "Geschäftsfunktion", fr: "Fonction métier", es: "Función de negocio", it: "Funzione business", pt: "Função de negócio", zh: "业务功能", ru: "Бизнес-функция" } },
  },
  {
    key: "arch_BusinessInteraction", grammarType: "BusinessInteraction",
    label: "Business Interaction", layer: "Business", aspect: "behavior",
    category: cat("Business"), icon: "handshake", defaultColor: col("Business"),
    defaultWidth: 140, defaultHeight: 55,
    translations: { label: { de: "Geschäftsinteraktion", fr: "Interaction métier", es: "Interacción de negocio", it: "Interazione business", pt: "Interação de negócio", zh: "业务交互", ru: "Бизнес-взаимодействие" } },
  },
  {
    key: "arch_BusinessEvent", grammarType: "BusinessEvent",
    label: "Business Event", layer: "Business", aspect: "behavior",
    category: cat("Business"), icon: "event", defaultColor: col("Business"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Geschäftsereignis", fr: "Événement métier", es: "Evento de negocio", it: "Evento business", pt: "Evento de negócio", zh: "业务事件", ru: "Бизнес-событие" } },
  },
  {
    key: "arch_BusinessService", grammarType: "BusinessService",
    label: "Business Service", layer: "Business", aspect: "behavior",
    category: cat("Business"), icon: "room_service", defaultColor: col("Business"),
    defaultWidth: 130, defaultHeight: 55,
    translations: { label: { de: "Geschäftsdienst", fr: "Service métier", es: "Servicio de negocio", it: "Servizio business", pt: "Serviço de negócio", zh: "业务服务", ru: "Бизнес-сервис" } },
  },
  // ── Business Layer — Passive Structure (4) ─────────────────────────────
  {
    key: "arch_BusinessObject", grammarType: "BusinessObject",
    label: "Business Object", layer: "Business", aspect: "passive_structure",
    category: cat("Business"), icon: "description", defaultColor: col("Business"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Geschäftsobjekt", fr: "Objet métier", es: "Objeto de negocio", it: "Oggetto business", pt: "Objeto de negócio", zh: "业务对象", ru: "Бизнес-объект" } },
  },
  {
    key: "arch_Contract", grammarType: "Contract",
    label: "Contract", layer: "Business", aspect: "passive_structure",
    category: cat("Business"), icon: "gavel", defaultColor: col("Business"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Vertrag", fr: "Contrat", es: "Contrato", it: "Contratto", pt: "Contrato", zh: "合同", ru: "Контракт" } },
  },
  {
    key: "arch_Representation", grammarType: "Representation",
    label: "Representation", layer: "Business", aspect: "passive_structure",
    category: cat("Business"), icon: "article", defaultColor: col("Business"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Darstellung", fr: "Représentation", es: "Representación", it: "Rappresentazione", pt: "Representação", zh: "表示", ru: "Представление" } },
  },
  {
    key: "arch_Product", grammarType: "Product",
    label: "Product", layer: "Business", aspect: "passive_structure",
    category: cat("Business"), icon: "inventory_2", defaultColor: col("Business"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Produkt", fr: "Produit", es: "Producto", it: "Prodotto", pt: "Produto", zh: "产品", ru: "Продукт" } },
  },
  // ── Application Layer — Active Structure (3) ───────────────────────────
  {
    key: "arch_ApplicationComponent", grammarType: "ApplicationComponent",
    label: "Application Component", layer: "Application", aspect: "active_structure",
    category: cat("Application"), icon: "widgets", defaultColor: col("Application"),
    defaultWidth: 160, defaultHeight: 55,
    translations: { label: { de: "Anwendungskomponente", fr: "Composant applicatif", es: "Componente de aplicación", it: "Componente applicativo", pt: "Componente de aplicação", zh: "应用组件", ru: "Компонент приложения" } },
  },
  {
    key: "arch_ApplicationCollaboration", grammarType: "ApplicationCollaboration",
    label: "Application Collaboration", layer: "Application", aspect: "active_structure",
    category: cat("Application"), icon: "join_inner", defaultColor: col("Application"),
    defaultWidth: 170, defaultHeight: 55,
    translations: { label: { de: "Anwendungskollaboration", fr: "Collaboration applicative", es: "Colaboración de aplicación", it: "Collaborazione applicativa", pt: "Colaboração de aplicação", zh: "应用协作", ru: "Коллаборация приложений" } },
  },
  {
    key: "arch_ApplicationInterface", grammarType: "ApplicationInterface",
    label: "Application Interface", layer: "Application", aspect: "active_structure",
    category: cat("Application"), icon: "sync_alt", defaultColor: col("Application"),
    defaultWidth: 155, defaultHeight: 55,
    translations: { label: { de: "Anwendungsschnittstelle", fr: "Interface applicative", es: "Interfaz de aplicación", it: "Interfaccia applicativa", pt: "Interface de aplicação", zh: "应用接口", ru: "Интерфейс приложения" } },
  },
  // ── Application Layer — Behavior (5) ───────────────────────────────────
  {
    key: "arch_ApplicationProcess", grammarType: "ApplicationProcess",
    label: "Application Process", layer: "Application", aspect: "behavior",
    category: cat("Application"), icon: "account_tree", defaultColor: col("Application"),
    defaultWidth: 150, defaultHeight: 55,
    translations: { label: { de: "Anwendungsprozess", fr: "Processus applicatif", es: "Proceso de aplicación", it: "Processo applicativo", pt: "Processo de aplicação", zh: "应用流程", ru: "Процесс приложения" } },
  },
  {
    key: "arch_ApplicationFunction", grammarType: "ApplicationFunction",
    label: "Application Function", layer: "Application", aspect: "behavior",
    category: cat("Application"), icon: "code", defaultColor: col("Application"),
    defaultWidth: 150, defaultHeight: 55,
    translations: { label: { de: "Anwendungsfunktion", fr: "Fonction applicative", es: "Función de aplicación", it: "Funzione applicativa", pt: "Função de aplicação", zh: "应用功能", ru: "Функция приложения" } },
  },
  {
    key: "arch_ApplicationInteraction", grammarType: "ApplicationInteraction",
    label: "Application Interaction", layer: "Application", aspect: "behavior",
    category: cat("Application"), icon: "compare_arrows", defaultColor: col("Application"),
    defaultWidth: 160, defaultHeight: 55,
    translations: { label: { de: "Anwendungsinteraktion", fr: "Interaction applicative", es: "Interacción de aplicación", it: "Interazione applicativa", pt: "Interação de aplicação", zh: "应用交互", ru: "Взаимодействие приложений" } },
  },
  {
    key: "arch_ApplicationEvent", grammarType: "ApplicationEvent",
    label: "Application Event", layer: "Application", aspect: "behavior",
    category: cat("Application"), icon: "notifications", defaultColor: col("Application"),
    defaultWidth: 145, defaultHeight: 55,
    translations: { label: { de: "Anwendungsereignis", fr: "Événement applicatif", es: "Evento de aplicación", it: "Evento applicativo", pt: "Evento de aplicação", zh: "应用事件", ru: "Событие приложения" } },
  },
  {
    key: "arch_ApplicationService", grammarType: "ApplicationService",
    label: "Application Service", layer: "Application", aspect: "behavior",
    category: cat("Application"), icon: "miscellaneous_services", defaultColor: col("Application"),
    defaultWidth: 150, defaultHeight: 55,
    translations: { label: { de: "Anwendungsdienst", fr: "Service applicatif", es: "Servicio de aplicación", it: "Servizio applicativo", pt: "Serviço de aplicação", zh: "应用服务", ru: "Сервис приложения" } },
  },
  // ── Application Layer — Passive Structure (1) ──────────────────────────
  {
    key: "arch_DataObject", grammarType: "DataObject",
    label: "Data Object", layer: "Application", aspect: "passive_structure",
    category: cat("Application"), icon: "database", defaultColor: col("Application"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Datenobjekt", fr: "Objet de données", es: "Objeto de datos", it: "Oggetto dati", pt: "Objeto de dados", zh: "数据对象", ru: "Объект данных" } },
  },
  // ── Technology Layer — Active Structure (5) ────────────────────────────
  {
    key: "arch_Node", grammarType: "Node",
    label: "Node", layer: "Technology", aspect: "active_structure",
    category: cat("Technology"), icon: "computer", defaultColor: col("Technology"),
    defaultWidth: 100, defaultHeight: 55,
    translations: { label: { de: "Knoten", fr: "Nœud", es: "Nodo", it: "Nodo", pt: "Nó", zh: "节点", ru: "Узел" } },
  },
  {
    key: "arch_Device", grammarType: "Device",
    label: "Device", layer: "Technology", aspect: "active_structure",
    category: cat("Technology"), icon: "devices", defaultColor: col("Technology"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Gerät", fr: "Dispositif", es: "Dispositivo", it: "Dispositivo", pt: "Dispositivo", zh: "设备", ru: "Устройство" } },
  },
  {
    key: "arch_SystemSoftware", grammarType: "SystemSoftware",
    label: "System Software", layer: "Technology", aspect: "active_structure",
    category: cat("Technology"), icon: "memory", defaultColor: col("Technology"),
    defaultWidth: 135, defaultHeight: 55,
    translations: { label: { de: "Systemsoftware", fr: "Logiciel système", es: "Software de sistema", it: "Software di sistema", pt: "Software de sistema", zh: "系统软件", ru: "Системное ПО" } },
  },
  {
    key: "arch_TechnologyCollaboration", grammarType: "TechnologyCollaboration",
    label: "Technology Collaboration", layer: "Technology", aspect: "active_structure",
    category: cat("Technology"), icon: "hub", defaultColor: col("Technology"),
    defaultWidth: 170, defaultHeight: 55,
    translations: { label: { de: "Technologiekollaboration", fr: "Collaboration technologique", es: "Colaboración tecnológica", it: "Collaborazione tecnologica", pt: "Colaboração tecnológica", zh: "技术协作", ru: "Технологическая коллаборация" } },
  },
  {
    key: "arch_TechnologyInterface", grammarType: "TechnologyInterface",
    label: "Technology Interface", layer: "Technology", aspect: "active_structure",
    category: cat("Technology"), icon: "settings_ethernet", defaultColor: col("Technology"),
    defaultWidth: 155, defaultHeight: 55,
    translations: { label: { de: "Technologieschnittstelle", fr: "Interface technologique", es: "Interfaz tecnológica", it: "Interfaccia tecnologica", pt: "Interface tecnológica", zh: "技术接口", ru: "Технологический интерфейс" } },
  },
  // ── Technology Layer — Behavior (5) ────────────────────────────────────
  {
    key: "arch_TechnologyProcess", grammarType: "TechnologyProcess",
    label: "Technology Process", layer: "Technology", aspect: "behavior",
    category: cat("Technology"), icon: "settings_backup_restore", defaultColor: col("Technology"),
    defaultWidth: 155, defaultHeight: 55,
    translations: { label: { de: "Technologieprozess", fr: "Processus technologique", es: "Proceso tecnológico", it: "Processo tecnologico", pt: "Processo tecnológico", zh: "技术流程", ru: "Технологический процесс" } },
  },
  {
    key: "arch_TechnologyFunction", grammarType: "TechnologyFunction",
    label: "Technology Function", layer: "Technology", aspect: "behavior",
    category: cat("Technology"), icon: "terminal", defaultColor: col("Technology"),
    defaultWidth: 155, defaultHeight: 55,
    translations: { label: { de: "Technologiefunktion", fr: "Fonction technologique", es: "Función tecnológica", it: "Funzione tecnologica", pt: "Função tecnológica", zh: "技术功能", ru: "Технологическая функция" } },
  },
  {
    key: "arch_TechnologyInteraction", grammarType: "TechnologyInteraction",
    label: "Technology Interaction", layer: "Technology", aspect: "behavior",
    category: cat("Technology"), icon: "swap_calls", defaultColor: col("Technology"),
    defaultWidth: 165, defaultHeight: 55,
    translations: { label: { de: "Technologieinteraktion", fr: "Interaction technologique", es: "Interacción tecnológica", it: "Interazione tecnologica", pt: "Interação tecnológica", zh: "技术交互", ru: "Технологическое взаимодействие" } },
  },
  {
    key: "arch_TechnologyEvent", grammarType: "TechnologyEvent",
    label: "Technology Event", layer: "Technology", aspect: "behavior",
    category: cat("Technology"), icon: "electric_bolt", defaultColor: col("Technology"),
    defaultWidth: 145, defaultHeight: 55,
    translations: { label: { de: "Technologieereignis", fr: "Événement technologique", es: "Evento tecnológico", it: "Evento tecnologico", pt: "Evento tecnológico", zh: "技术事件", ru: "Технологическое событие" } },
  },
  {
    key: "arch_TechnologyService", grammarType: "TechnologyService",
    label: "Technology Service", layer: "Technology", aspect: "behavior",
    category: cat("Technology"), icon: "cloud", defaultColor: col("Technology"),
    defaultWidth: 150, defaultHeight: 55,
    translations: { label: { de: "Technologiedienst", fr: "Service technologique", es: "Servicio tecnológico", it: "Servizio tecnologico", pt: "Serviço tecnológico", zh: "技术服务", ru: "Технологический сервис" } },
  },
  // ── Technology Layer — Infrastructure (3) ──────────────────────────────
  {
    key: "arch_Path", grammarType: "Path",
    label: "Path", layer: "Technology", aspect: "passive_structure",
    category: cat("Technology"), icon: "cable", defaultColor: col("Technology"),
    defaultWidth: 100, defaultHeight: 55,
    translations: { label: { de: "Pfad", fr: "Chemin", es: "Ruta", it: "Percorso", pt: "Caminho", zh: "路径", ru: "Путь" } },
  },
  {
    key: "arch_CommunicationNetwork", grammarType: "CommunicationNetwork",
    label: "Communication Network", layer: "Technology", aspect: "passive_structure",
    category: cat("Technology"), icon: "lan", defaultColor: col("Technology"),
    defaultWidth: 175, defaultHeight: 55,
    translations: { label: { de: "Kommunikationsnetz", fr: "Réseau de communication", es: "Red de comunicación", it: "Rete di comunicazione", pt: "Rede de comunicação", zh: "通信网络", ru: "Коммуникационная сеть" } },
  },
  {
    key: "arch_Artifact", grammarType: "Artifact",
    label: "Artifact", layer: "Technology", aspect: "passive_structure",
    category: cat("Technology"), icon: "folder_zip", defaultColor: col("Technology"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Artefakt", fr: "Artéfact", es: "Artefacto", it: "Artefatto", pt: "Artefato", zh: "工件", ru: "Артефакт" } },
  },
  // ── Motivation Layer (10) ───────────────────────────────────────────────
  {
    key: "arch_Stakeholder", grammarType: "Stakeholder",
    label: "Stakeholder", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "supervisor_account", defaultColor: col("Motivation"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Stakeholder", fr: "Partie prenante", es: "Parte interesada", it: "Stakeholder", pt: "Parte interessada", zh: "利益相关者", ru: "Заинтересованная сторона" } },
  },
  {
    key: "arch_Driver", grammarType: "Driver",
    label: "Driver", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "directions", defaultColor: col("Motivation"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Treiber", fr: "Moteur", es: "Impulsor", it: "Driver", pt: "Impulsionador", zh: "驱动因素", ru: "Движущая сила" } },
  },
  {
    key: "arch_Assessment", grammarType: "Assessment",
    label: "Assessment", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "rate_review", defaultColor: col("Motivation"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Bewertung", fr: "Évaluation", es: "Evaluación", it: "Valutazione", pt: "Avaliação", zh: "评估", ru: "Оценка" } },
  },
  {
    key: "arch_Goal", grammarType: "Goal",
    label: "Goal", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "flag", defaultColor: col("Motivation"),
    defaultWidth: 100, defaultHeight: 55,
    translations: { label: { de: "Ziel", fr: "Objectif", es: "Objetivo", it: "Obiettivo", pt: "Objetivo", zh: "目标", ru: "Цель" } },
  },
  {
    key: "arch_Outcome", grammarType: "Outcome",
    label: "Outcome", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "emoji_events", defaultColor: col("Motivation"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Ergebnis", fr: "Résultat", es: "Resultado", it: "Risultato", pt: "Resultado", zh: "成果", ru: "Результат" } },
  },
  {
    key: "arch_Principle", grammarType: "Principle",
    label: "Principle", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "policy", defaultColor: col("Motivation"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Prinzip", fr: "Principe", es: "Principio", it: "Principio", pt: "Princípio", zh: "原则", ru: "Принцип" } },
  },
  {
    key: "arch_Requirement", grammarType: "Requirement",
    label: "Requirement", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "checklist", defaultColor: col("Motivation"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Anforderung", fr: "Exigence", es: "Requisito", it: "Requisito", pt: "Requisito", zh: "需求", ru: "Требование" } },
  },
  {
    key: "arch_Constraint", grammarType: "Constraint",
    label: "Constraint", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "block", defaultColor: col("Motivation"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Einschränkung", fr: "Contrainte", es: "Restricción", it: "Vincolo", pt: "Restrição", zh: "约束", ru: "Ограничение" } },
  },
  {
    key: "arch_Meaning", grammarType: "Meaning",
    label: "Meaning", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "lightbulb", defaultColor: col("Motivation"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Bedeutung", fr: "Signification", es: "Significado", it: "Significato", pt: "Significado", zh: "含义", ru: "Значение" } },
  },
  {
    key: "arch_Value", grammarType: "Value",
    label: "Value", layer: "Motivation", aspect: "motivation",
    category: cat("Motivation"), icon: "diamond", defaultColor: col("Motivation"),
    defaultWidth: 100, defaultHeight: 55,
    translations: { label: { de: "Wert", fr: "Valeur", es: "Valor", it: "Valore", pt: "Valor", zh: "价值", ru: "Ценность" } },
  },
  // ── Strategy Layer (4) ──────────────────────────────────────────────────
  {
    key: "arch_Resource", grammarType: "Resource",
    label: "Resource", layer: "Strategy", aspect: "active_structure",
    category: cat("Strategy"), icon: "category", defaultColor: col("Strategy"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Ressource", fr: "Ressource", es: "Recurso", it: "Risorsa", pt: "Recurso", zh: "资源", ru: "Ресурс" } },
  },
  {
    key: "arch_Capability", grammarType: "Capability",
    label: "Capability", layer: "Strategy", aspect: "behavior",
    category: cat("Strategy"), icon: "account_tree", defaultColor: col("Strategy"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Fähigkeit", fr: "Capacité", es: "Capacidad", it: "Capacità", pt: "Capacidade", zh: "能力", ru: "Возможность" } },
  },
  {
    key: "arch_ValueStream", grammarType: "ValueStream",
    label: "Value Stream", layer: "Strategy", aspect: "behavior",
    category: cat("Strategy"), icon: "stream", defaultColor: col("Strategy"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Wertstrom", fr: "Flux de valeur", es: "Flujo de valor", it: "Flusso di valore", pt: "Fluxo de valor", zh: "价值流", ru: "Поток создания ценности" } },
  },
  {
    key: "arch_CourseOfAction", grammarType: "CourseOfAction",
    label: "Course of Action", layer: "Strategy", aspect: "behavior",
    category: cat("Strategy"), icon: "map", defaultColor: col("Strategy"),
    defaultWidth: 140, defaultHeight: 55,
    translations: { label: { de: "Vorgehensweise", fr: "Plan d'action", es: "Curso de acción", it: "Piano d'azione", pt: "Curso de ação", zh: "行动方案", ru: "Курс действий" } },
  },
  // ── Implementation & Migration Layer (5) ───────────────────────────────
  {
    key: "arch_WorkPackage", grammarType: "WorkPackage",
    label: "Work Package", layer: "Implementation", aspect: "behavior",
    category: cat("Implementation"), icon: "assignment", defaultColor: col("Implementation"),
    defaultWidth: 130, defaultHeight: 55,
    translations: { label: { de: "Arbeitspaket", fr: "Lot de travaux", es: "Paquete de trabajo", it: "Pacchetto di lavoro", pt: "Pacote de trabalho", zh: "工作包", ru: "Рабочий пакет" } },
  },
  {
    key: "arch_ImplementationEvent", grammarType: "ImplementationEvent",
    label: "Implementation Event", layer: "Implementation", aspect: "behavior",
    category: cat("Implementation"), icon: "rocket_launch", defaultColor: col("Implementation"),
    defaultWidth: 170, defaultHeight: 55,
    translations: { label: { de: "Implementierungsereignis", fr: "Événement d'implémentation", es: "Evento de implementación", it: "Evento di implementazione", pt: "Evento de implementação", zh: "实施事件", ru: "Событие реализации" } },
  },
  {
    key: "arch_Deliverable", grammarType: "Deliverable",
    label: "Deliverable", layer: "Implementation", aspect: "passive_structure",
    category: cat("Implementation"), icon: "task", defaultColor: col("Implementation"),
    defaultWidth: 120, defaultHeight: 55,
    translations: { label: { de: "Lieferobjekt", fr: "Livrable", es: "Entregable", it: "Deliverable", pt: "Entregável", zh: "可交付成果", ru: "Результат" } },
  },
  {
    key: "arch_Gap", grammarType: "Gap",
    label: "Gap", layer: "Implementation", aspect: "passive_structure",
    category: cat("Implementation"), icon: "compare", defaultColor: col("Implementation"),
    defaultWidth: 100, defaultHeight: 55,
    translations: { label: { de: "Lücke", fr: "Écart", es: "Brecha", it: "Gap", pt: "Lacuna", zh: "差距", ru: "Разрыв" } },
  },
  {
    key: "arch_Plateau", grammarType: "Plateau",
    label: "Plateau", layer: "Implementation", aspect: "composite",
    category: cat("Implementation"), icon: "layers", defaultColor: col("Implementation"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Plateau", fr: "Plateau", es: "Meseta", it: "Plateau", pt: "Patamar", zh: "阶段目标", ru: "Плато" } },
  },
  // ── Physical Layer (4) ──────────────────────────────────────────────────
  {
    key: "arch_Equipment", grammarType: "Equipment",
    label: "Equipment", layer: "Physical", aspect: "active_structure",
    category: cat("Physical"), icon: "build", defaultColor: col("Physical"),
    defaultWidth: 115, defaultHeight: 55,
    translations: { label: { de: "Ausrüstung", fr: "Équipement", es: "Equipo", it: "Attrezzatura", pt: "Equipamento", zh: "设备", ru: "Оборудование" } },
  },
  {
    key: "arch_Facility", grammarType: "Facility",
    label: "Facility", layer: "Physical", aspect: "active_structure",
    category: cat("Physical"), icon: "warehouse", defaultColor: col("Physical"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Einrichtung", fr: "Installation", es: "Instalación", it: "Struttura", pt: "Instalação", zh: "设施", ru: "Объект" } },
  },
  {
    key: "arch_DistributionNetwork", grammarType: "DistributionNetwork",
    label: "Distribution Network", layer: "Physical", aspect: "passive_structure",
    category: cat("Physical"), icon: "share", defaultColor: col("Physical"),
    defaultWidth: 165, defaultHeight: 55,
    translations: { label: { de: "Verteilnetz", fr: "Réseau de distribution", es: "Red de distribución", it: "Rete di distribuzione", pt: "Rede de distribuição", zh: "分销网络", ru: "Сеть распределения" } },
  },
  {
    key: "arch_Material", grammarType: "Material",
    label: "Material", layer: "Physical", aspect: "passive_structure",
    category: cat("Physical"), icon: "inventory", defaultColor: col("Physical"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Material", fr: "Matériau", es: "Material", it: "Materiale", pt: "Material", zh: "材料", ru: "Материал" } },
  },
  // ── Composite Elements (3) ──────────────────────────────────────────────
  {
    key: "arch_Grouping", grammarType: "Grouping",
    label: "Grouping", layer: "Composite", aspect: "composite",
    category: cat("Composite"), icon: "folder_open", defaultColor: col("Composite"),
    defaultWidth: 200, defaultHeight: 100,
    translations: { label: { de: "Gruppierung", fr: "Regroupement", es: "Agrupación", it: "Raggruppamento", pt: "Agrupamento", zh: "分组", ru: "Группировка" } },
  },
  {
    key: "arch_Location", grammarType: "Location",
    label: "Location", layer: "Composite", aspect: "composite",
    category: cat("Composite"), icon: "location_on", defaultColor: col("Composite"),
    defaultWidth: 110, defaultHeight: 55,
    translations: { label: { de: "Standort", fr: "Lieu", es: "Ubicación", it: "Posizione", pt: "Localização", zh: "位置", ru: "Местоположение" } },
  },
  {
    key: "arch_Junction", grammarType: "Junction",
    label: "Junction", layer: "Composite", aspect: "composite",
    category: cat("Composite"), icon: "join_full", defaultColor: col("Composite"),
    defaultWidth: 40, defaultHeight: 40,
    translations: { label: { de: "Verbindung", fr: "Jonction", es: "Unión", it: "Giunzione", pt: "Junção", zh: "交汇点", ru: "Соединение" } },
  },
];

// ── Relation Definitions ─────────────────────────────────────────────────────

export const ARCHIMATE_RELATION_DEFS: ArchimateRelationDef[] = [
  {
    key: "arch_rel_Association", grammarType: "Association",
    label: "associated with", reverseLabel: "associated with",
    lineStyle: "solid", sourceMarker: "none", targetMarker: "none",
    translations: { label: { de: "assoziiert mit", fr: "associé à", es: "asociado con", it: "associato a", pt: "associado a", zh: "关联", ru: "связан с" } },
  },
  {
    key: "arch_rel_Composition", grammarType: "Composition",
    label: "composed of", reverseLabel: "part of",
    lineStyle: "solid", sourceMarker: "filled_diamond", targetMarker: "none",
    translations: { label: { de: "zusammengesetzt aus", fr: "composé de", es: "compuesto de", it: "composto da", pt: "composto de", zh: "组成", ru: "состоит из" } },
  },
  {
    key: "arch_rel_Aggregation", grammarType: "Aggregation",
    label: "aggregates", reverseLabel: "aggregated in",
    lineStyle: "solid", sourceMarker: "hollow_diamond", targetMarker: "none",
    translations: { label: { de: "aggregiert", fr: "agrège", es: "agrega", it: "aggrega", pt: "agrega", zh: "聚合", ru: "агрегирует" } },
  },
  {
    key: "arch_rel_Realization", grammarType: "Realization",
    label: "realizes", reverseLabel: "realized by",
    lineStyle: "dashed", sourceMarker: "none", targetMarker: "hollow_arrow",
    translations: { label: { de: "realisiert", fr: "réalise", es: "realiza", it: "realizza", pt: "realiza", zh: "实现", ru: "реализует" } },
  },
  {
    key: "arch_rel_Assignment", grammarType: "Assignment",
    label: "assigned to", reverseLabel: "has assigned",
    lineStyle: "solid", sourceMarker: "filled_circle", targetMarker: "hollow_arrow",
    translations: { label: { de: "zugewiesen an", fr: "assigné à", es: "asignado a", it: "assegnato a", pt: "atribuído a", zh: "分配给", ru: "назначен" } },
  },
  {
    key: "arch_rel_Serving", grammarType: "Serving",
    label: "serves", reverseLabel: "served by",
    lineStyle: "solid", sourceMarker: "none", targetMarker: "open_arrow",
    translations: { label: { de: "bedient", fr: "dessert", es: "sirve a", it: "serve", pt: "serve", zh: "服务", ru: "обслуживает" } },
  },
  {
    key: "arch_rel_Access", grammarType: "Access",
    label: "accesses", reverseLabel: "accessed by",
    lineStyle: "dashed", sourceMarker: "none", targetMarker: "open_arrow",
    translations: { label: { de: "greift zu auf", fr: "accède à", es: "accede a", it: "accede a", pt: "acessa", zh: "访问", ru: "обращается к" } },
  },
  {
    key: "arch_rel_Influence", grammarType: "Influence",
    label: "influences", reverseLabel: "influenced by",
    lineStyle: "dashed", sourceMarker: "none", targetMarker: "open_arrow",
    translations: { label: { de: "beeinflusst", fr: "influence", es: "influye en", it: "influenza", pt: "influencia", zh: "影响", ru: "влияет на" } },
  },
  {
    key: "arch_rel_Triggering", grammarType: "Triggering",
    label: "triggers", reverseLabel: "triggered by",
    lineStyle: "solid", sourceMarker: "none", targetMarker: "filled_arrow",
    translations: { label: { de: "löst aus", fr: "déclenche", es: "desencadena", it: "innesca", pt: "aciona", zh: "触发", ru: "инициирует" } },
  },
  {
    key: "arch_rel_Flow", grammarType: "Flow",
    label: "flows to", reverseLabel: "flows from",
    lineStyle: "dashed", sourceMarker: "none", targetMarker: "filled_arrow",
    translations: { label: { de: "fließt zu", fr: "s'écoule vers", es: "fluye hacia", it: "fluisce verso", pt: "flui para", zh: "流向", ru: "передаёт данные в" } },
  },
  {
    key: "arch_rel_Specialization", grammarType: "Specialization",
    label: "specializes", reverseLabel: "generalized by",
    lineStyle: "solid", sourceMarker: "none", targetMarker: "hollow_triangle",
    translations: { label: { de: "spezialisiert", fr: "spécialise", es: "especializa", it: "specializza", pt: "especializa", zh: "特化", ru: "специализирует" } },
  },
];
