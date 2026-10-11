import { useEffect, useState } from "react";
import { browser } from "#imports";
import { SelectField } from "~/components/ui/select";
import {
  createNotificationReminderStore,
  defaultNotificationReminderPreferences,
  isNotificationReminderPauseHours,
  NOTIFICATION_REMINDER_PAUSE_HOURS,
  type NotificationReminderPauseHours,
} from "~/lib/notification-reminders";

const store = createNotificationReminderStore();
const getMessage = browser.i18n.getMessage as (
  key: string,
  substitutions?: string | string[],
) => string;

const optionLabel = (hours: NotificationReminderPauseHours) =>
  getMessage(`pauseRemindersFor${hours}Hours`) || `${hours} hours`;

export const NotificationReminderPreferenceControl = () => {
  const [defaultPauseHours, setDefaultPauseHours] =
    useState<NotificationReminderPauseHours>(
      defaultNotificationReminderPreferences.defaultPauseHours,
    );

  useEffect(() => {
    let mounted = true;
    store.load().then((preferences) => {
      if (mounted) setDefaultPauseHours(preferences.defaultPauseHours);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (value: string) => {
    const numeric = Number(value);
    if (!isNotificationReminderPauseHours(numeric)) return;
    setDefaultPauseHours(numeric);
    void store.setDefaultPauseHours(numeric);
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <SelectField
        id="notification-reminder-default-pause"
        label={getMessage("defaultPauseTimeLabel") || "Default pause time"}
        value={String(defaultPauseHours)}
        onValueChange={handleChange}
        options={NOTIFICATION_REMINDER_PAUSE_HOURS.map((hours) => ({
          value: String(hours),
          label: optionLabel(hours),
        }))}
      />
      <p className="text-muted-foreground text-xs">
        {getMessage("defaultPauseTimeDescription") ||
          "Used when you pause reminders from a notification."}
      </p>
    </section>
  );
};
