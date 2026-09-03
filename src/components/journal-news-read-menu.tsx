"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckCheck, ChevronDown } from "lucide-react";

import type { JournalNewsReadRange } from "@/lib/journal-news-state";

const OPTIONS: Array<{ label: string; range: JournalNewsReadRange }> = [
  { label: "All articles", range: "all" },
  { label: "Older than 1 day", range: "day" },
  { label: "Older than 1 week", range: "week" },
];

export function JournalNewsReadMenu({
  disabled = false,
  isOptionDisabled,
  marking = false,
  onSelect,
}: {
  disabled?: boolean;
  isOptionDisabled?: (range: JournalNewsReadRange) => boolean;
  marking?: boolean;
  onSelect: (range: JournalNewsReadRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;

    function closeMenu(event: MouseEvent | globalThis.KeyboardEvent) {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") {
        return;
      }
      if (
        event instanceof MouseEvent &&
        containerRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
      if (event instanceof globalThis.KeyboardEvent) toggleRef.current?.focus();
    }

    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [open]);

  function openAndFocusFirstOption() {
    setOpen(true);
    window.requestAnimationFrame(() =>
      optionRefs.current.find((option) => option && !option.disabled)?.focus(),
    );
  }

  function handleToggleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openAndFocusFirstOption();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = optionRefs.current.filter(
      (option): option is HTMLButtonElement => Boolean(option && !option.disabled),
    );
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (Math.max(0, currentIndex) + (event.key === "ArrowDown" ? 1 : -1) +
              options.length) %
            options.length;
    options[nextIndex].focus();
  }

  function select(range: JournalNewsReadRange) {
    setOpen(false);
    onSelect(range);
  }

  return (
    <div className="journal-news-read-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="journal-news-read-menu-toggle"
        disabled={disabled || marking}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleToggleKeyDown}
        ref={toggleRef}
        type="button"
      >
        <CheckCheck aria-hidden="true" size={16} />
        {marking ? "Marking…" : "Mark as read"}
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      {open ? (
        <div
          className="journal-news-read-menu-options"
          onKeyDown={handleMenuKeyDown}
          role="menu"
        >
          {OPTIONS.map((option, index) => (
            <button
              disabled={isOptionDisabled?.(option.range)}
              key={option.range}
              onClick={() => select(option.range)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              role="menuitem"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
