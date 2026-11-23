"use client";

import { useSyncExternalStore } from "react";
import { getAuthState, getInitialAuthState, subscribeToAuthState } from "@/preview/lib/api-client";

export const useAuth = () =>
  useSyncExternalStore(subscribeToAuthState, getAuthState, getInitialAuthState);
