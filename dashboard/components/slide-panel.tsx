"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

export function SlidePanel({
  open,
  onClose,
  title,
  children,
  width = "w-[60%]",
}: SlidePanelProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className={`fixed right-0 top-0 bottom-0 z-50 ${width} bg-zinc-950 border-l border-zinc-800 flex flex-col`}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 p-4">
              <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
              <button
                onClick={onClose}
                className="text-zinc-400 hover:text-zinc-100 transition-colors p-1 rounded-md hover:bg-zinc-800"
                aria-label="Close panel"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 5L5 15" />
                  <path d="M5 5L15 15" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
