/**
 * JSX types for Cropper.js v2's custom elements.
 *
 * Cropper v2 ships web components rather than a DOM-building constructor, and
 * `src/components/files/crop-stage.tsx` writes them out directly so every
 * attribute is explicit — which is what allows the out-of-bounds selection to
 * be intercepted (see that file for why).
 *
 * React 19 passes unknown props straight through as attributes, so booleans are
 * declared as strings here: `movable="true"` becomes the attribute Cropper
 * reads, whereas `movable={true}` does not reliably survive. Numbers are
 * strings for the same reason.
 */

import type React from "react";

interface CropperElementAttributes
  extends React.HTMLAttributes<HTMLElement>,
    React.RefAttributes<HTMLElement> {
  readonly class?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "cropper-canvas": CropperElementAttributes & {
        readonly background?: string;
        readonly disabled?: boolean;
        readonly scaleStep?: string;
        readonly themeColor?: string;
      };
      "cropper-image": CropperElementAttributes & {
        readonly src?: string;
        readonly alt?: string;
        readonly "initial-fit"?: "none" | "contain" | "cover";
        readonly rotatable?: string;
        readonly scalable?: string;
        readonly skewable?: string;
        readonly translatable?: string;
        readonly slottable?: string;
      };
      "cropper-shade": CropperElementAttributes & {
        readonly hidden?: boolean;
        readonly x?: string;
        readonly y?: string;
      };
      "cropper-handle": CropperElementAttributes & {
        readonly action?: string;
        readonly plain?: string;
        readonly "theme-color"?: string;
      };
      "cropper-selection": CropperElementAttributes & {
        readonly x?: string;
        readonly y?: string;
        readonly width?: string;
        readonly height?: string;
        readonly "aspect-ratio"?: string;
        readonly "initial-aspect-ratio"?: string;
        readonly "initial-coverage"?: string;
        readonly dynamic?: string;
        readonly movable?: string;
        readonly resizable?: string;
        readonly zoomable?: string;
        readonly multiple?: string;
        readonly keyboard?: string;
        readonly outlined?: string;
        readonly precise?: string;
      };
      "cropper-grid": CropperElementAttributes & {
        readonly role?: string;
        readonly bordered?: string;
        readonly covered?: string;
        readonly rows?: string;
        readonly columns?: string;
      };
      "cropper-crosshair": CropperElementAttributes & {
        readonly centered?: string;
      };
      "cropper-viewer": CropperElementAttributes & {
        readonly selection?: string;
      };
    }
  }
}
