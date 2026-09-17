import { FileText, UserRound } from "lucide-react";
import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import { FillPanel } from "~/components/fill/fill-panel";
import { Layout } from "~/components/layout/layout";
import { OnboardingForm } from "~/components/memory/onboarding-form";
import { Button } from "~/components/ui/button";
import { useSound } from "~/lib/sfx/react";

const View = { FILL: "fill", ONBOARDING: "onboarding" } as const;
type View = (typeof View)[keyof typeof View];

const SidePanel = () => {
  const [view, setView] = useState<View>(View.FILL);
  const sound = useSound();

  const selectView = (nextView: View) => {
    if (nextView === view) return;
    setView(nextView);
    sound.play("sidepanelViewSwitch");
  };

  const headerAction =
    view === View.FILL ? (
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
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="font-normal"
        onClick={() => selectView(View.FILL)}
      >
        <FileText className="size-4" />
        Current page
      </Button>
    );

  return (
    <Layout headerAction={headerAction}>
      <div className="flex w-full flex-col gap-4">
        {view === View.FILL ? <FillPanel /> : <OnboardingForm />}
      </div>
    </Layout>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SidePanel />
  </React.StrictMode>,
);
