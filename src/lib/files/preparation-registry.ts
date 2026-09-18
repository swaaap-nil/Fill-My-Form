import type {
  FileInspection,
  FilePreparationAdapter,
} from "~/core/files/preparation";
import type { FileReferenceStore } from "./adapters";
import { ImagePreparationAdapter } from "./image-preparation-adapter";
import { PdfPreparationAdapter } from "./pdf-preparation-adapter";

export class FilePreparationRegistry {
  constructor(readonly adapters: readonly FilePreparationAdapter[]) {}

  adapterFor(inspection: FileInspection) {
    return this.adapters.find((adapter) => adapter.canHandle(inspection));
  }
}

export const createBrowserFilePreparationRegistry = (
  store: FileReferenceStore,
) =>
  new FilePreparationRegistry([
    new ImagePreparationAdapter(store),
    new PdfPreparationAdapter(store),
  ]);
