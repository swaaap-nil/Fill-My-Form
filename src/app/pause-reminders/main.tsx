import { BellOff } from "lucide-react";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { browser } from "#imports";
import { Layout } from "~/components/layout/layout";
import { Button } from "~/components/ui/button";
import {
  createNotificationReminderStore,
  defaultNotificationReminderPreferences,
  NOTIFICATION_REMINDER_PAUSE_HOURS,
  type NotificationReminderPauseHours,
} from "~/lib/notification-reminders";

const store = createNotificationReminderStore();

const getMessage = browser.i18n.getMessage as (
  key: string,
  substitutions?: string | string[],
) => string;

const message = (key: string, substitutions?: string | string[]) =>
  getMessage(key, substitutions);

const optionLabel = (hours: NotificationReminderPauseHours) =>
  message(`pauseRemindersFor${hours}Hours`) || `Pause for ${hours} hours`;

const PauseReminders = () => {
  const [defaultPauseHours, setDefaultPauseHours] =
    useState<NotificationReminderPauseHours>(
      defaultNotificationReminderPreferences.defaultPauseHours,
    );
  const [pausedHours, setPausedHours] =
    useState<NotificationReminderPauseHours | null>(null);

  useEffect(() => {
    store.load().then((preferences) => {
      setDefaultPauseHours(preferences.defaultPauseHours);
    });
  }, []);

  const pause = async (hours: NotificationReminderPauseHours) => {
    await store.pauseForHours(hours);
    setPausedHours(hours);
  };

  return (
    <Layout className="max-w-[32rem]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm shadow-black/5 dark:shadow-black/20">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BellOff className="size-4" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="font-semibold text-lg leading-tight">
                {message("pauseRemindersTitle") || "Pause reminders"}
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {message("pauseRemindersDescription") ||
                  "Choose how long Fill My Form should hide form reminders."}
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {NOTIFICATION_REMINDER_PAUSE_HOURS.map((hours) => (
              <Button
                key={hours}
                type="button"
                variant={hours === defaultPauseHours ? "default" : "outline"}
                onClick={() => void pause(hours)}
              >
                {optionLabel(hours)}
              </Button>
            ))}
          </div>

          {pausedHours && (
            <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-emerald-800 text-sm dark:text-emerald-200">
              {message("remindersPausedForHours", String(pausedHours)) ||
                `Reminders paused for ${pausedHours} hours`}
            </p>
          )}
        </section>
      </main>
    </Layout>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PauseReminders />
  </React.StrictMode>,
);
