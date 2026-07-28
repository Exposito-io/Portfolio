"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

type JournalTagInputProps = {
  suggestions: string[];
  value: string[];
  onChange: (tags: string[]) => void;
};

export function JournalTagInput({
  suggestions,
  value,
  onChange,
}: JournalTagInputProps) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const availableSuggestions = useMemo(() => {
    const selected = new Set(value.map((tag) => tag.toLocaleLowerCase()));
    const query = draft.trim().toLocaleLowerCase();

    return suggestions.filter(
      (tag) =>
        !selected.has(tag.toLocaleLowerCase()) &&
        (!query || tag.toLocaleLowerCase().includes(query)),
    );
  }, [draft, suggestions, value]);

  function addTag(candidate: string) {
    const tag = candidate.trim();
    if (!tag || value.length >= 8) return;
    if (value.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setDraft("");
      return;
    }

    onChange([...value, tag]);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
      return;
    }

    if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 focus-within:border-[#1f7a68] focus-within:ring-2 focus-within:ring-[#1f7a68]/15"
      >
        {value.map((tag) => (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[#e8f2ee] py-1 pl-3 pr-1.5 text-sm font-bold text-[#1f6b5c]"
            key={tag}
          >
            {tag}
            <button
              aria-label={`Remove ${tag} tag`}
              className="flex size-5 items-center justify-center rounded-full hover:bg-[#1f7a68]/10"
              onClick={() => onChange(value.filter((item) => item !== tag))}
              type="button"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          aria-autocomplete="list"
          aria-controls="entry-tag-suggestions"
          aria-expanded={focused && availableSuggestions.length > 0}
          className="min-w-32 flex-1 bg-transparent py-1 text-sm text-[#1f2523] outline-none placeholder:text-[#8a918d]"
          id="entry-tags"
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length ? "Add another…" : "Add a tag…"}
          role="combobox"
          type="text"
          value={draft}
        />
      </div>

      {focused && availableSuggestions.length ? (
        <div
          className="absolute z-10 mt-2 max-h-48 w-full overflow-y-auto rounded-lg border border-black/10 bg-white p-1.5 shadow-xl"
          id="entry-tag-suggestions"
          role="listbox"
        >
          {availableSuggestions.map((tag) => (
            <button
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-[#39423e] hover:bg-[#f1eee7]"
              key={tag}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addTag(tag)}
              aria-selected="false"
              role="option"
              type="button"
            >
              <Plus size={14} aria-hidden="true" />
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
