import { useEffect, useState } from "react";

export const useObjectUrl = (
  object: Blob | MediaSource | undefined,
): string | undefined => {
  const [entry, setEntry] = useState<{
    readonly object: Blob | MediaSource;
    readonly url: string;
  }>();

  useEffect(() => {
    if (!object) {
      setEntry(undefined);
      return;
    }

    const nextUrl = URL.createObjectURL(object);
    setEntry({ object, url: nextUrl });
    return () => URL.revokeObjectURL(nextUrl);
  }, [object]);

  if (!entry || entry.object !== object) return undefined;
  return entry.url;
};
