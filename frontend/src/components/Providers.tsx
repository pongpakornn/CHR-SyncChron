"use client";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "./Toasts";
import { DialogProvider } from "./ui/Dialogs";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
