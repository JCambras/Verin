"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * True once the component has hydrated on the client (false during SSR). Uses
 * useSyncExternalStore so there is no setState-in-effect. Gate interactive submit
 * buttons on this so a click before hydration cannot trigger a native form submit.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );
}
