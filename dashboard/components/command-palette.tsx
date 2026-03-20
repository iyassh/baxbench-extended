"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search, Monitor, AlertTriangle, FileCode } from "lucide-react";

export interface SearchItem {
  type: "model" | "cwe" | "scenario";
  label: string;
  href: string;
  subtitle?: string;
}

interface CommandPaletteProps {
  items: SearchItem[];
}

const iconMap = {
  model: Monitor,
  cwe: AlertTriangle,
  scenario: FileCode,
} as const;

const groupLabels = {
  model: "Models",
  cwe: "CWEs",
  scenario: "Scenarios",
} as const;

export function CommandPalette({ items }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Listen for Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for custom event from nav button
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    document.addEventListener("open-command-palette", handleOpen);
    return () =>
      document.removeEventListener("open-command-palette", handleOpen);
  }, []);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  // Group items by type
  const models = items.filter((item) => item.type === "model");
  const cwes = items.filter((item) => item.type === "cwe");
  const scenarios = items.filter((item) => item.type === "scenario");

  const groups = [
    { key: "model" as const, items: models },
    { key: "scenario" as const, items: scenarios },
    { key: "cwe" as const, items: cwes },
  ].filter((g) => g.items.length > 0);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search commands"
      overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
      contentClassName="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
      loop
    >
      {/* Input */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4">
        <Search className="h-4 w-4 shrink-0 text-zinc-400" />
        <Command.Input
          placeholder="Search models, CWEs, scenarios..."
          className="h-12 w-full bg-transparent text-sm text-white placeholder:text-zinc-400 focus:outline-none"
        />
      </div>

      {/* List */}
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-zinc-400">
          No results found.
        </Command.Empty>

        {groups.map(({ key, items: groupItems }) => {
          const GroupIcon = iconMap[key];
          return (
            <Command.Group
              key={key}
              heading={
                <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <GroupIcon className="h-3 w-3" />
                  {groupLabels[key]}
                </span>
              }
            >
              {groupItems.map((item) => {
                const Icon = iconMap[item.type];
                return (
                  <Command.Item
                    key={item.href}
                    value={item.label}
                    keywords={item.subtitle ? [item.subtitle] : undefined}
                    onSelect={() => handleSelect(item.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-zinc-300 transition-colors data-[selected=true]:bg-zinc-800 data-[selected=true]:text-white"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="flex flex-col">
                      <span>{item.label}</span>
                      {item.subtitle && (
                        <span className="text-xs text-zinc-500">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          );
        })}
      </Command.List>

      {/* Footer hint */}
      <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2">
        <span className="text-xs text-zinc-500">Navigate with arrow keys</span>
        <div className="flex items-center gap-1">
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            Enter
          </kbd>
          <span className="text-xs text-zinc-500">to select</span>
          <kbd className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            Esc
          </kbd>
          <span className="text-xs text-zinc-500">to close</span>
        </div>
      </div>
    </Command.Dialog>
  );
}
