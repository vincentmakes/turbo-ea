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
