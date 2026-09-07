import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import { FillPanel } from "~/components/fill/fill-panel";
import { Layout } from "~/components/layout/layout";
import { OnboardingForm } from "~/components/memory/onboarding-form";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

/**
 * No tab primitive exists yet in `src/components/ui/`, so this is two
 * plain toggle buttons over local state rather than an invented tab
 * component — a placeholder that works, not a design decision. See
 * `_context.md`'s "Building UI" section.
 */
const View = { FILL: "fill", ONBOARDING: "onboarding" } as const;
type View = (typeof View)[keyof typeof View];

const SidePanel = () => {
  const [view, setView] = useState<View>(View.FILL);

  return (
    <Layout>
      <div className="flex w-full flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
          <Button
            type="button"
            variant={view === View.FILL ? "default" : "ghost"}
            size="sm"
            onClick={() => setView(View.FILL)}
          >
            Current page
          </Button>
          <Button
            type="button"
            variant={view === View.ONBOARDING ? "default" : "ghost"}
            size="sm"
            onClick={() => setView(View.ONBOARDING)}
          >
            My information
          </Button>
        </div>
        <Separator />
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
