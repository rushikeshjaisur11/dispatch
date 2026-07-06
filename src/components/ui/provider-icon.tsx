import { Sparkles, Bot, HardDrive, Wrench, Brain } from "lucide-react";

const ICONS: Record<string, typeof Sparkles> = {
  openai: Sparkles,
  anthropic: Bot,
  local: HardDrive,
  custom: Wrench,
};

export function ProviderIcon({ provider, className = "size-4" }: { provider: string; className?: string }) {
  const Icon = ICONS[provider] ?? Brain;
  return <Icon className={className} />;
}
