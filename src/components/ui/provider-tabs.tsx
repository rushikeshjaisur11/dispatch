import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "./provider-icon";

export interface ProviderTabItem {
  id: string;
  name: string;
}

interface ProviderTabsProps {
  providers: ProviderTabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderIcon?: (providerId: string) => ReactNode;
}

/** Trimmed from Dhwani's ProviderTabs (src/components/ui/ProviderTabs.tsx) — dropped
 * react-i18next (agentpad has no i18n) and the "recommended"/disabled affordances,
 * which aren't needed for a plain provider picker. */
export function ProviderTabs({ providers, selectedId, onSelect, renderIcon }: ProviderTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const selectedIndex = providers.findIndex((p) => p.id === selectedId);
    if (selectedIndex === -1) {
      indicator.style.opacity = "0";
      return;
    }
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-tab-button]");
    const selectedButton = buttons[selectedIndex];
    if (!selectedButton) return;
    const rect = selectedButton.getBoundingClientRect();
    indicator.style.width = `${rect.width}px`;
    indicator.style.height = `${rect.height}px`;
    indicator.style.transform = `translate(${selectedButton.offsetLeft}px, ${selectedButton.offsetTop}px)`;
    indicator.style.opacity = "1";
  }, [providers, selectedId]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    const observer = new ResizeObserver(() => updateIndicator());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateIndicator]);

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1 p-0.5">
      <div
        ref={indicatorRef}
        className="absolute top-0 left-0 rounded-full bg-primary/10 ring-1 ring-primary/30 transition-[width,height,transform,opacity] duration-200 ease-out pointer-events-none"
        style={{ opacity: 0 }}
      />
      {providers.map((provider) => (
        <button
          key={provider.id}
          data-tab-button
          type="button"
          onClick={() => onSelect(provider.id)}
          className={cn(
            "relative z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium text-xs whitespace-nowrap transition-colors duration-150",
            selectedId === provider.id
              ? "text-foreground [&_svg]:text-primary"
              : "text-muted-foreground ring-1 ring-border/60 hover:text-foreground hover:bg-foreground/4",
          )}
        >
          {renderIcon ? renderIcon(provider.id) : <ProviderIcon provider={provider.id} />}
          <span>{provider.name}</span>
        </button>
      ))}
    </div>
  );
}
