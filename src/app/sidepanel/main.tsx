import { ChevronLeft, FileImage, UserRound } from "lucide-react";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { FilePreparationTool } from "~/components/files/file-preparation-tool";
import { FillPanel } from "~/components/fill/fill-panel";
import { FirstRunAccessGate } from "~/components/fill/first-run-access-gate";
import { Layout } from "~/components/layout/layout";
import { OnboardingForm } from "~/components/memory/onboarding-form";
import { Button } from "~/components/ui/button";
import { shouldShowFirstRunAccessGate } from "~/lib/first-run-access";
import { useSound } from "~/lib/sfx/react";

const View = {
  FILL: "fill",
  ONBOARDING: "onboarding",
  PREPARE: "prepare",
} as const;
type View = (typeof View)[keyof typeof View];

const SidePanel = () => {
  const [view, setView] = useState<View>(View.FILL);
  const [showAccessGate, setShowAccessGate] = useState<boolean | null>(null);
  const sound = useSound();

  useEffect(() => {
    shouldShowFirstRunAccessGate().then(setShowAccessGate);
  }, []);

  const selectView = (nextView: View) => {
    if (nextView === view) return;
    setView(nextView);
    sound.play("sidepanelViewSwitch");
  };

  const headerAction =
    view === View.FILL ? (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="font-normal"
          onClick={() => selectView(View.PREPARE)}
        >
          <FileImage className="size-4" />
          Prepare file
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="font-normal"
          onClick={() => selectView(View.ONBOARDING)}
        >
          <UserRound className="size-4" />
          My information
        </Button>
      </>
    ) : view === View.PREPARE ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="font-normal"
        onClick={() => selectView(View.FILL)}
      >
        <ChevronLeft className="size-4" />
        Back to home
      </Button>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="font-normal"
        onClick={() => selectView(View.FILL)}
      >
        <ChevronLeft className="size-4" />
        Back to home
      </Button>
    );

  if (showAccessGate === null) {
    return (
      <Layout headerAction={headerAction}>
        <div className="flex w-full flex-col gap-4" aria-busy="true" />
      </Layout>
    );
  }

  return (
    <Layout headerAction={headerAction}>
      <div className="flex w-full flex-col gap-4">
        {view === View.FILL && showAccessGate ? (
          <FirstRunAccessGate onComplete={() => setShowAccessGate(false)} />
        ) : view === View.FILL ? (
          <FillPanel />
        ) : view === View.PREPARE ? (
          <FilePreparationTool />
        ) : (
          <OnboardingForm />
        )}
      </div>
    </Layout>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SidePanel />
  </React.StrictMode>,
);
