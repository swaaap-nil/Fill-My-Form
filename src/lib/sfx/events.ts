import { CUES, type CueName, type PlayOptions } from "uisfx";

export const SELECTED_SFX_PACK = "soft";
export const DEFAULT_SFX_VOLUME = 1.0;

export const SFX_EVENT_CUES = {
  sidepanelViewSwitch: "select",
  proposalDetailsOpened: "open",
  proposalDetailsClosed: "back",
  scanStarted: "scanning",
  scanSucceeded: "success",
  scanBlocked: "blocked",
  scanFailed: "error",
  fillStarted: "processing",
  fillSucceeded: "complete",
  fillFailed: "error",
  accessRevoked: "lock",
  agentStarted: "start",
  agentBusy: "processing",
  agentNeedsAttention: "notification",
  agentCompleted: "complete",
  agentFailed: "error",
  agentAnswerSent: "send",
  agentReviewConfirmed: "success",
  agentReviewSkipped: "cancel",
  unrecognizedFieldConfirmed: "reward",
  unrecognizedFieldDismissed: "reaction",
  memoryTyping: "typing",
  memorySaveSucceeded: "success",
  memorySaveFailed: "error",
  fileTagging: "processing",
  fileSourceSelected: "select",
  fileSelected: "select",
  filePrepareStarted: "processing",
  filePrepareSucceeded: "success",
  filePrepareFailed: "error",
  fileEditorOpened: "open",
  fileEditorSaved: "success",
  fileEditorCancelled: "cancel",
  fileDragStarted: "send",
  fileDragFinished: "complete",
  fileDragFailed: "error",
  localDataExported: "success",
  localDataImported: "success",
  localDataImportFailed: "error",
  wipePromptOpened: "warning",
  wipePromptCancelled: "cancel",
  localDataWiped: "delete",
  localDataWipeFailed: "error",
  soundEnabled: "toggle-on",
  soundDisabled: "toggle-off",
  soundVolumeChanged: "volume-change",
} as const satisfies Record<string, CueName>;

export type SfxEvent = keyof typeof SFX_EVENT_CUES;

const LOOP_CUES = new Set<CueName>([
  "loading",
  "processing",
  "recording",
  "connecting",
  "scanning",
  "streaming",
]);

export const isLoopEvent = (event: SfxEvent): boolean =>
  LOOP_CUES.has(SFX_EVENT_CUES[event]);

export const isKnownCue = (cue: string): cue is CueName =>
  CUES.some((item) => item.name === cue);

export const optionsForEvent = (event: SfxEvent): PlayOptions | undefined => {
  if (event === "memoryTyping") return { volume: 0.18, cooldownMs: 0 };
  if (event === "soundVolumeChanged") return { cooldownMs: 120 };
  return undefined;
};
