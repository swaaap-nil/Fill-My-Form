import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "~/components/common/error-boundary";
import { ImageEditor } from "~/components/files/image-editor";
import { cn } from "~/lib/utils";
import "~/assets/styles/globals.css";

const systemDarkQuery = "(prefers-color-scheme: dark)";

/**
 * The editor window is its own document, so it does not inherit the side
 * panel's theme class and has to resolve dark mode itself. It deliberately
 * skips the shared `Layout`: a header and footer would eat vertical space the
 * image needs, which is the entire reason this window exists.
 */
const useSystemPrefersDark = () => {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia(systemDarkQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(systemDarkQuery);
    const handleChange = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersDark;
};

const EditorApp = () => {
  const prefersDark = useSystemPrefersDark();
  const sessionId = new URLSearchParams(window.location.search).get("session");

  return (
    <div
      data-testid="editor-root"
      className={cn(
        "min-h-dvh bg-background font-sans text-base text-foreground",
        { dark: prefersDark },
      )}
    >
      {/* A throw in here used to leave an empty window with no way out and no
          hint as to why. The editor is a separate window, so there is no
          surrounding UI to fall back to. */}
      <ErrorBoundary
        fallback={
          <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-destructive text-sm">
              The image editor could not start. Close this window and try again
              from the panel.
            </p>
          </div>
        }
      >
        {sessionId ? (
          <ImageEditor sessionId={sessionId} />
        ) : (
          <div className="flex h-dvh items-center justify-center p-6 text-center text-muted-foreground text-sm">
            This window was opened without an editing session.
          </div>
        )}
      </ErrorBoundary>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);
