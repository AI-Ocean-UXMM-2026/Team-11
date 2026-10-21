"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

// The protected workspace owns its cache. It is discarded when the viewer
// changes or leaves the workspace; private data is never persisted in storage.
export function WorkspaceQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
