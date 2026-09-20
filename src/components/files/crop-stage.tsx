import { useCallback, useEffect, useRef, useState } from "react";
import { boundCropSelection, rectContains } from "~/core/files/geometry";
import type { CropRect } from "~/core/files/preparation";

/**
 * The cropper, built from Cropper.js v2's custom elements directly rather than
 * through `new Cropper(element)`.
 *
 * Doing it by hand is what makes the bounds fix possible. **Cropper.js v2 has
 * no bounding option** — `cropper-selection` exposes `movable`, `resizable`,
 * `zoomable`, `initialCoverage` and friends, but nothing that keeps the
 * selection inside the image (checked against `cropperjs/dist/cropper.d.ts`).
 * Left alone it will happily be dragged off the picture, which is why the old
 * editor exported blank strips: the selection was larger than the image and the
 * canvas dutifully drew the emptiness around it.
 *
 * The supported way to refuse a change is to listen for the selection's
 * `change` event and call `preventDefault()`, which is what `onSelectionChange`
 * does below via `rectContains`. That predicate lives in `~/core/files/geometry`
 * so the rule itself is unit-tested without a browser.
 */

export interface CropStageHandle {
  getSelection(): CropRect | undefined;
  setSelection(rect: Partial<CropRect>): void;
  rotate(degrees: number): void;
  scale(x: number, y: number): void;
  zoom(factor: number): void;
  fit(): void;
  reset(): void;
  toCanvas(size?: {
    width: number;
    height: number;
  }): Promise<HTMLCanvasElement | undefined>;
  naturalSize(): { width: number; height: number } | undefined;
}

interface CropperSelectionElement extends HTMLElement {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
  $change(
    x: number,
    y: number,
    width?: number,
    height?: number,
    aspectRatio?: number,
    force?: boolean,
  ): unknown;
  $move(x: number, y?: number): unknown;
  $reset(): unknown;
  $toCanvas(options?: {
    width?: number;
    height?: number;
  }): Promise<HTMLCanvasElement>;
}

interface CropperImageElement extends HTMLElement {
  $rotate(angle: number | string): unknown;
  $scale(x: number, y?: number): unknown;
  $zoom(scale: number): unknown;
  $center(size?: string): unknown;
  $resetTransform(): unknown;
  $getTransform(): number[];
  $setTransform(values: number[]): unknown;
  $ready(): Promise<HTMLImageElement>;
}

/** The image's painted rectangle, in the canvas's coordinate space. */
const imageBounds = (
  canvas: HTMLElement,
  image: HTMLElement,
): CropRect | undefined => {
  const canvasRect = canvas.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  if (imageRect.width === 0 || imageRect.height === 0) return undefined;
  return {
    x: imageRect.left - canvasRect.left,
    y: imageRect.top - canvasRect.top,
    width: imageRect.width,
    height: imageRect.height,
  };
};

export const CropStage = ({
  src,
  aspectRatio,
  onSelectionChange,
  onReady,
  className,
}: {
  readonly src: string;
  readonly aspectRatio?: number;
  readonly onSelectionChange?: (rect: CropRect) => void;
  readonly onReady?: (handle: CropStageHandle) => void;
  readonly className?: string;
}) => {
  const canvasRef = useRef<HTMLElement>(null);
  const imageRef = useRef<CropperImageElement>(null);
  const selectionRef = useRef<CropperSelectionElement>(null);

  /**
   * Until this import resolves, `<cropper-selection>` and friends are ordinary
   * unknown elements: they render, but they have none of Cropper's methods.
   * Every effect below therefore waits on `registered` — calling `$reset()` on
   * an un-upgraded element throws, and an exception during an effect takes the
   * whole window down with it.
   */
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    let active = true;
    void import("cropperjs").then(() => {
      if (active) setRegistered(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const clampToImage = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const selection = selectionRef.current;
    if (!canvas || !image || !selection) return;
    if (typeof selection.$change !== "function") return;
    const bounds = imageBounds(canvas, image);
    if (!bounds) return;
    const current: CropRect = {
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height,
    };
    if (rectContains(bounds, current)) return;
    const clamped = boundCropSelection(bounds, current, aspectRatio);
    selection.$change(
      clamped.x,
      clamped.y,
      clamped.width,
      clamped.height,
      aspectRatio,
      true,
    );
  }, [aspectRatio]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const selection = selectionRef.current;
    if (!canvas || !image || !selection) return;

    let clampFrame: number | undefined;
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<CropRect>).detail;
      const bounds = imageBounds(canvas, image);
      if (!bounds) return;
      // Correct the proposed rect rather than cancelling the gesture outright;
      // otherwise an initially invalid box can become impossible to move.
      if (!rectContains(bounds, detail)) {
        event.preventDefault();
        const clamped = boundCropSelection(bounds, detail, aspectRatio);
        if (clampFrame) cancelAnimationFrame(clampFrame);
        clampFrame = requestAnimationFrame(() => {
          clampFrame = undefined;
          if (!selection.isConnected) return;
          selection.$change(
            clamped.x,
            clamped.y,
            clamped.width,
            clamped.height,
            aspectRatio,
            true,
          );
        });
        return;
      }
      onSelectionChange?.(detail);
    };

    selection.addEventListener("change", onChange);
    return () => {
      if (clampFrame) cancelAnimationFrame(clampFrame);
      selection.removeEventListener("change", onChange);
    };
  }, [aspectRatio, onSelectionChange]);

  // A resize changes the painted image rect, so a selection that was legal can
  // be stranded outside the new one.
  useEffect(() => {
    const handle = () => clampToImage();
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [clampToImage]);

  useEffect(() => {
    const selection = selectionRef.current;
    if (!registered || !selection) return;
    selection.aspectRatio = aspectRatio ?? 0;
    selection.$reset?.();
    clampToImage();
  }, [registered, aspectRatio, clampToImage]);

  useEffect(() => {
    const image = imageRef.current;
    const selection = selectionRef.current;
    const canvas = canvasRef.current;
    if (!registered || !image || !selection || !canvas || !onReady) return;

    let cancelled = false;

    /**
     * Waits for the image to actually occupy space, rather than for
     * `$ready()`.
     *
     * `$ready` resolves on the image's load event, and a blob URL in this
     * window decodes long before the dynamic `import("cropperjs")` that
     * upgrades the element — so by the time `$ready` exists to be called, the
     * event it waits for has already been and gone, and the promise never
     * settles. Measuring the painted rect asks the question we actually care
     * about ("is there something to clamp against yet?") and is immune to the
     * ordering.
     */
    const whenPainted = (): Promise<void> =>
      new Promise((resolve) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          if (cancelled) return resolve();
          if (imageBounds(canvas, image) || Date.now() > deadline) {
            return resolve();
          }
          requestAnimationFrame(check);
        };
        check();
      });

    void whenPainted().then(() => {
      if (cancelled) return;
      clampToImage();
      onReady({
        getSelection: () => ({
          x: selection.x,
          y: selection.y,
          width: selection.width,
          height: selection.height,
        }),
        setSelection: (rect) => {
          const bounds = imageBounds(canvas, image);
          const next: CropRect = {
            x: rect.x ?? selection.x,
            y: rect.y ?? selection.y,
            width: rect.width ?? selection.width,
            height: rect.height ?? selection.height,
          };
          const safe = bounds
            ? boundCropSelection(bounds, next, aspectRatio)
            : next;
          selection.$change(
            safe.x,
            safe.y,
            safe.width,
            safe.height,
            aspectRatio,
            true,
          );
        },
        rotate: (degrees) => {
          image.$rotate(`${degrees}deg`);
          clampToImage();
        },
        scale: (x, y) => {
          image.$scale(x, y);
          clampToImage();
        },
        zoom: (factor) => {
          image.$zoom(factor);
          clampToImage();
        },
        fit: () => {
          image.$center("contain");
          selection.$reset();
          clampToImage();
        },
        reset: () => {
          image.$resetTransform();
          image.$center("contain");
          selection.$reset();
          clampToImage();
        },
        // $toCanvas applies the image's transform matrix, so rotation and
        // flips are handled once here rather than reimplemented in the adapter.
        toCanvas: async (size) => {
          try {
            return await selection.$toCanvas(size);
          } catch {
            return undefined;
          }
        },
        naturalSize: () => {
          const natural = canvas.querySelector("img");
          return natural
            ? { width: natural.naturalWidth, height: natural.naturalHeight }
            : undefined;
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [registered, onReady, aspectRatio, clampToImage]);

  return (
    <cropper-canvas
      ref={canvasRef}
      background="true"
      class={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <cropper-image
        ref={imageRef}
        src={src}
        alt="Image being cropped"
        initial-fit="contain"
        rotatable="true"
        scalable="true"
        translatable="true"
      />
      <cropper-shade hidden />
      <cropper-handle action="select" plain="true" />
      <cropper-selection
        ref={selectionRef}
        initial-coverage="0.9"
        movable="true"
        resizable="true"
        outlined="true"
        precise="true"
        keyboard="true"
      >
        <cropper-grid role="grid" covered="true" />
        <cropper-crosshair centered="true" />
        <cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)" />
        <cropper-handle action="n-resize" />
        <cropper-handle action="e-resize" />
        <cropper-handle action="s-resize" />
        <cropper-handle action="w-resize" />
        <cropper-handle action="ne-resize" />
        <cropper-handle action="nw-resize" />
        <cropper-handle action="se-resize" />
        <cropper-handle action="sw-resize" />
      </cropper-selection>
    </cropper-canvas>
  );
};
