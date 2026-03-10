import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// English namespace files
import commonEn from "./locales/en/common.json";
import authEn from "./locales/en/auth.json";
import navEn from "./locales/en/nav.json";
import inventoryEn from "./locales/en/inventory.json";
import cardsEn from "./locales/en/cards.json";
import reportsEn from "./locales/en/reports.json";
import adminEn from "./locales/en/admin.json";
import bpmEn from "./locales/en/bpm.json";
import diagramsEn from "./locales/en/diagrams.json";
import deliveryEn from "./locales/en/delivery.json";
import notificationsEn from "./locales/en/notifications.json";
import validationEn from "./locales/en/validation.json";

// French
import commonFr from "./locales/fr/common.json";
import authFr from "./locales/fr/auth.json";
import navFr from "./locales/fr/nav.json";
import inventoryFr from "./locales/fr/inventory.json";
import cardsFr from "./locales/fr/cards.json";
import reportsFr from "./locales/fr/reports.json";
import adminFr from "./locales/fr/admin.json";
import bpmFr from "./locales/fr/bpm.json";
import diagramsFr from "./locales/fr/diagrams.json";
import deliveryFr from "./locales/fr/delivery.json";
import notificationsFr from "./locales/fr/notifications.json";
import validationFr from "./locales/fr/validation.json";

// Spanish
import commonEs from "./locales/es/common.json";
import authEs from "./locales/es/auth.json";
import navEs from "./locales/es/nav.json";
import inventoryEs from "./locales/es/inventory.json";
import cardsEs from "./locales/es/cards.json";
import reportsEs from "./locales/es/reports.json";
import adminEs from "./locales/es/admin.json";
import bpmEs from "./locales/es/bpm.json";
import diagramsEs from "./locales/es/diagrams.json";
import deliveryEs from "./locales/es/delivery.json";
import notificationsEs from "./locales/es/notifications.json";
import validationEs from "./locales/es/validation.json";

// Italian
import commonIt from "./locales/it/common.json";
import authIt from "./locales/it/auth.json";
import navIt from "./locales/it/nav.json";
import inventoryIt from "./locales/it/inventory.json";
import cardsIt from "./locales/it/cards.json";
import reportsIt from "./locales/it/reports.json";
import adminIt from "./locales/it/admin.json";
import bpmIt from "./locales/it/bpm.json";
import diagramsIt from "./locales/it/diagrams.json";
import deliveryIt from "./locales/it/delivery.json";
import notificationsIt from "./locales/it/notifications.json";
import validationIt from "./locales/it/validation.json";

// Portuguese
import commonPt from "./locales/pt/common.json";
import authPt from "./locales/pt/auth.json";
import navPt from "./locales/pt/nav.json";
import inventoryPt from "./locales/pt/inventory.json";
import cardsPt from "./locales/pt/cards.json";
import reportsPt from "./locales/pt/reports.json";
import adminPt from "./locales/pt/admin.json";
import bpmPt from "./locales/pt/bpm.json";
import diagramsPt from "./locales/pt/diagrams.json";
import deliveryPt from "./locales/pt/delivery.json";
import notificationsPt from "./locales/pt/notifications.json";
import validationPt from "./locales/pt/validation.json";

// Chinese
import commonZh from "./locales/zh/common.json";
import authZh from "./locales/zh/auth.json";
import navZh from "./locales/zh/nav.json";
import inventoryZh from "./locales/zh/inventory.json";
import cardsZh from "./locales/zh/cards.json";
import reportsZh from "./locales/zh/reports.json";
import adminZh from "./locales/zh/admin.json";
import bpmZh from "./locales/zh/bpm.json";
import diagramsZh from "./locales/zh/diagrams.json";
import deliveryZh from "./locales/zh/delivery.json";
import notificationsZh from "./locales/zh/notifications.json";
import validationZh from "./locales/zh/validation.json";

// German
import commonDe from "./locales/de/common.json";
import authDe from "./locales/de/auth.json";
import navDe from "./locales/de/nav.json";
import inventoryDe from "./locales/de/inventory.json";
import cardsDe from "./locales/de/cards.json";
import reportsDe from "./locales/de/reports.json";
import adminDe from "./locales/de/admin.json";
import bpmDe from "./locales/de/bpm.json";
import diagramsDe from "./locales/de/diagrams.json";
import deliveryDe from "./locales/de/delivery.json";
import notificationsDe from "./locales/de/notifications.json";
import validationDe from "./locales/de/validation.json";

// Russian
import commonRu from "./locales/ru/common.json";
import authRu from "./locales/ru/auth.json";
import navRu from "./locales/ru/nav.json";
import inventoryRu from "./locales/ru/inventory.json";
import cardsRu from "./locales/ru/cards.json";
import reportsRu from "./locales/ru/reports.json";
import adminRu from "./locales/ru/admin.json";
import bpmRu from "./locales/ru/bpm.json";
import diagramsRu from "./locales/ru/diagrams.json";
import deliveryRu from "./locales/ru/delivery.json";
import notificationsRu from "./locales/ru/notifications.json";
import validationRu from "./locales/ru/validation.json";

export const SUPPORTED_LOCALES = ["en", "de", "fr", "es", "it", "pt", "zh", "ru"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  zh: "中文",
  ru: "Русский",
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        auth: authEn,
        nav: navEn,
        inventory: inventoryEn,
        cards: cardsEn,
        reports: reportsEn,
        admin: adminEn,
        bpm: bpmEn,
        diagrams: diagramsEn,
        delivery: deliveryEn,
        notifications: notificationsEn,
        validation: validationEn,
      },
      fr: {
        common: commonFr,
        auth: authFr,
        nav: navFr,
        inventory: inventoryFr,
        cards: cardsFr,
        reports: reportsFr,
        admin: adminFr,
        bpm: bpmFr,
        diagrams: diagramsFr,
        delivery: deliveryFr,
        notifications: notificationsFr,
        validation: validationFr,
      },
      es: {
        common: commonEs,
        auth: authEs,
        nav: navEs,
        inventory: inventoryEs,
        cards: cardsEs,
        reports: reportsEs,
        admin: adminEs,
        bpm: bpmEs,
        diagrams: diagramsEs,
        delivery: deliveryEs,
        notifications: notificationsEs,
        validation: validationEs,
      },
      it: {
        common: commonIt,
        auth: authIt,
        nav: navIt,
        inventory: inventoryIt,
        cards: cardsIt,
        reports: reportsIt,
        admin: adminIt,
        bpm: bpmIt,
        diagrams: diagramsIt,
        delivery: deliveryIt,
        notifications: notificationsIt,
        validation: validationIt,
      },
      pt: {
        common: commonPt,
        auth: authPt,
        nav: navPt,
        inventory: inventoryPt,
        cards: cardsPt,
        reports: reportsPt,
        admin: adminPt,
        bpm: bpmPt,
        diagrams: diagramsPt,
        delivery: deliveryPt,
        notifications: notificationsPt,
        validation: validationPt,
      },
      zh: {
        common: commonZh,
        auth: authZh,
        nav: navZh,
        inventory: inventoryZh,
        cards: cardsZh,
        reports: reportsZh,
        admin: adminZh,
        bpm: bpmZh,
        diagrams: diagramsZh,
        delivery: deliveryZh,
        notifications: notificationsZh,
        validation: validationZh,
      },
      de: {
        common: commonDe,
        auth: authDe,
        nav: navDe,
        inventory: inventoryDe,
        cards: cardsDe,
        reports: reportsDe,
        admin: adminDe,
        bpm: bpmDe,
        diagrams: diagramsDe,
        delivery: deliveryDe,
        notifications: notificationsDe,
        validation: validationDe,
      },
      ru: {
        common: commonRu,
        auth: authRu,
        nav: navRu,
        inventory: inventoryRu,
        cards: cardsRu,
        reports: reportsRu,
        admin: adminRu,
        bpm: bpmRu,
        diagrams: diagramsRu,
        delivery: deliveryRu,
        notifications: notificationsRu,
        validation: validationRu,
      },
    },
    fallbackLng: "en",
    returnEmptyString: false, // treat "" as missing → fall back to English
    defaultNS: "common",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: "turboea-locale",
    },
  });

export default i18n;
