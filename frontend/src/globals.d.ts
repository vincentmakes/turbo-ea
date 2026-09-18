declare const __APP_VERSION__: string;

/**
 * `bpmn-js-color-picker` ships no type declarations. It exports a single didi
 * module descriptor, which is exactly what `Modeler`'s `additionalModules`
 * expects — declaring it as `ModuleDeclaration` keeps the call site fully
 * type-checked instead of falling back to `any`. See BpmnModeler.tsx (#910).
 */
declare module "bpmn-js-color-picker" {
  const colorPickerModule: import("didi").ModuleDeclaration;
  export default colorPickerModule;
}

/**
 * `bpmn-js-create-append-anything` ships no type declarations either. It
 * exports named didi module descriptors: the create/append-anything menus and
 * an optional element-templates integration we do not use.
 */
declare module "bpmn-js-create-append-anything" {
  export const CreateAppendAnythingModule: import("didi").ModuleDeclaration;
  export const CreateAppendElementTemplatesModule: import("didi").ModuleDeclaration;
}

/**
 * `bpmn-js-properties-panel` ships its `.d.ts` only for the source tree, not
 * for the `dist/` entry the package resolves to, so the two module descriptors
 * used here are declared by hand. `@bpmn-io/properties-panel` (the widget
 * library underneath) is only ever imported for its stylesheet.
 */
declare module "bpmn-js-properties-panel" {
  export const BpmnPropertiesPanelModule: import("didi").ModuleDeclaration;
  export const BpmnPropertiesProviderModule: import("didi").ModuleDeclaration;
}
