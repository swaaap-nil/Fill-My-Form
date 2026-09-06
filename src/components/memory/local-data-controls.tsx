import { Download, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { browser } from "#imports";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { sendMessage } from "~/lib/messaging";

const WIPE_CONFIRMATION = "delete my data";

type LocalDataMessageKey =
  | "localDataExport"
  | "localDataImport"
  | "localDataWipe"
  | "localDataDelete"
  | "localDataCancel"
  | "localDataWipePrompt"
  | "localDataExported"
  | "localDataImported"
  | "localDataImportFailed"
  | "localDataDeleted";

const message = (key: LocalDataMessageKey) => browser.i18n.getMessage(key);

export const LocalDataControls = ({
  onDataChanged,
}: {
  readonly onDataChanged: () => void;
}) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wipeText, setWipeText] = useState("");

  const exportData = async () => {
    const { data } = await sendMessage("exportLocalData", undefined);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `form-agent-data-${data.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(message("localDataExported"));
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    const payload = JSON.parse(await file.text()) as unknown;
    const result = await sendMessage("importLocalData", { payload });
    setStatus(
      result.ok
        ? message("localDataImported")
        : message("localDataImportFailed"),
    );
    if (result.ok) onDataChanged();
    if (fileInput.current) fileInput.current.value = "";
  };

  const wipeData = async () => {
    if (wipeText !== WIPE_CONFIRMATION) return;
    await sendMessage("wipeLocalData", undefined);
    setConfirmingWipe(false);
    setWipeText("");
    setStatus(message("localDataDeleted"));
    onDataChanged();
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={exportData}>
          <Download className="size-4" />
          {message("localDataExport")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-4" />
          {message("localDataImport")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => setConfirmingWipe(true)}
        >
          <Trash2 className="size-4" />
          {message("localDataWipe")}
        </Button>
      </div>
      <Input
        ref={fileInput}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => importData(event.target.files?.[0])}
      />
      {confirmingWipe && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="wipe-confirmation">
            {message("localDataWipePrompt")}
          </Label>
          <Input
            id="wipe-confirmation"
            value={wipeText}
            onChange={(event) => setWipeText(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={wipeText !== WIPE_CONFIRMATION}
              onClick={wipeData}
            >
              {message("localDataDelete")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmingWipe(false)}
            >
              {message("localDataCancel")}
            </Button>
          </div>
        </div>
      )}
      {status && (
        <p
          className="text-muted-foreground text-xs"
          data-testid="local-data-status"
        >
          {status}
        </p>
      )}
    </section>
  );
};
