import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/AuthProvider";
import { I18nProvider } from "@/lib/I18nProvider";
import { UndoProvider } from "@/lib/undoable";
import { ThemeProvider } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "@/App";
import { installZoomGuard } from "@/lib/zoom";
import "./index.css";

installZoomGuard();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            <I18nProvider>
              <UndoProvider>
                <TooltipProvider delayDuration={300}>
                  <App />
                </TooltipProvider>
              </UndoProvider>
            </I18nProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
