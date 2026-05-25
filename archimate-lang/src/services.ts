import {
  inject,
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  type DefaultSharedCoreModuleContext,
} from "langium";
import {
  ArchiMateGeneratedModule,
  ArchiMateGeneratedSharedModule,
} from "./generated/module.js";

export type ArchiMateServices = ReturnType<typeof createArchiMateServices>;

export function createArchiMateServices(context: DefaultSharedCoreModuleContext) {
  const shared = inject(
    createDefaultSharedCoreModule(context),
    ArchiMateGeneratedSharedModule,
  );
  const ArchiMate = inject(
    createDefaultCoreModule({ shared }),
    ArchiMateGeneratedModule,
  );
  // Register the language so the document factory can resolve it by file extension
  shared.ServiceRegistry.register(ArchiMate);
  return { shared, ArchiMate };
}
