import type { ProactiveSuppressionConfig } from "./config";
import { isCredentialOnlyPage } from "./credential-only-page";

export { proactiveSuppressionConfig } from "./config";
export { isCredentialOnlyPage } from "./credential-only-page";

export const shouldSuppressProactiveDetection = (
  doc: Document,
  config: ProactiveSuppressionConfig,
): boolean => {
  if (config.credentialOnlyPages && isCredentialOnlyPage(doc)) return true;
  return false;
};
