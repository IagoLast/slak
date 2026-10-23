"use client";

import { useSyncExternalStore } from "react";
import { ConversationView, isConversationView } from "@/lib/work-view";

const key = "slak:conversation-view";
let fallback: ConversationView = "answers";

function getSnapshot(): ConversationView {
  try {
    const stored = window.localStorage.getItem(key);
    return isConversationView(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(key, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(key, onChange);
  };
}

export function useConversationView() {
  const view = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "answers" as const,
  );
  function setView(value: string) {
    if (!isConversationView(value)) return;
    fallback = value;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* Private storage may be disabled. */
    }
    window.dispatchEvent(new Event(key));
  }
  return [view, setView] as const;
}
