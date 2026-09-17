import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "~/components/common/error-boundary";
import { Suspense } from "~/components/common/suspense";
import { Footer } from "~/components/layout/footer";
import { Header } from "~/components/layout/header";
import { Toaster } from "~/components/ui/sonner";
import { SoundProvider } from "~/lib/sfx/react";
import { cn } from "~/lib/utils";
import "~/assets/styles/globals.css";

interface LayoutProps {
  readonly children?: React.ReactNode;
  readonly headerAction?: React.ReactNode;
  readonly loadingFallback?: React.ReactElement;
  readonly errorFallback?: React.ReactElement;
  readonly className?: string;
}

const queryClient = new QueryClient();
const systemDarkQuery = "(prefers-color-scheme: dark)";

export const Layout = ({
  children,
  headerAction,
  loadingFallback,
  errorFallback,
  className,
}: LayoutProps) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary fallback={errorFallback}>
        <Suspense fallback={loadingFallback}>
          <SoundProvider>
            <LayoutContent className={className} headerAction={headerAction}>
              {children}
            </LayoutContent>
          </SoundProvider>
        </Suspense>
      </ErrorBoundary>
    </QueryClientProvider>
  );
};

const LayoutContent = ({
  children,
  headerAction,
  className,
}: {
  readonly children?: React.ReactNode;
  readonly headerAction?: React.ReactNode;
  readonly className?: string;
}) => {
  const prefersDark = useSystemPrefersDark();

  return (
    <div
      data-testid="panel-root"
      className={cn(
        "flex min-h-screen w-full min-w-[23rem] flex-col items-center justify-center bg-background text-base text-foreground font-sans",
        {
          dark: prefersDark,
        },
      )}
    >
      <div
        className={cn(
          "flex w-full max-w-[80rem] grow flex-col items-center justify-between gap-5 bg-background p-5",
          className,
        )}
      >
        <Header action={headerAction} />
        {children}
        <Footer />
      </div>
      <Toaster />
    </div>
  );
};

const useSystemPrefersDark = () => {
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia(systemDarkQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(systemDarkQuery);
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return prefersDark;
};
