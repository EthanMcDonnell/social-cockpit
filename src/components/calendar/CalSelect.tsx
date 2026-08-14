"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * A listbox that looks like the rest of the cockpit.
 *
 * The native <select> renders its popup with the OS chrome — rounded, blue
 * highlight, system font — which lands in the middle of an otherwise square,
 * amber, monospaced panel. This replaces the popup only: the trigger still
 * behaves like a select (keyboard, typeahead, aria roles), so nothing about the
 * interaction has to be relearned.
 *
 * The menu is portalled and positioned `fixed` so a drawer's overflow can't clip
 * it, but it portals into the nearest `.cockpit` root rather than <body> so it
 * still inherits the theme tokens.
 */

export interface CalSelectOption {
  value: string;
  label: string;
  /** Optional trailing annotation, e.g. a UTC offset. Dimmed. */
  hint?: string;
}

interface CalSelectProps {
  value: string;
  options: CalSelectOption[];
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  /** Shown when `value` matches none of the options. */
  placeholder?: string;
  disabled?: boolean;
  /** Which trigger edge the menu lines up with. Use "end" near the right edge. */
  align?: "start" | "end";
  "aria-label"?: string;
}

/** Gap between the trigger and the menu, in px. */
const GAP = 5;
const MENU_MAX_H = 320;
/** Typeahead resets after this long without a keystroke, like a native select. */
const TYPE_RESET_MS = 700;

interface Box {
  left: number;
  /** Exactly one of these is set — a flipped menu anchors to the trigger's top
   *  edge, so a short list doesn't float detached above it. */
  top?: number;
  bottom?: number;
  minWidth: number;
  maxHeight: number;
}

export function CalSelect({
  value,
  options,
  onChange,
  id,
  className,
  placeholder = "Select…",
  disabled,
  align = "start",
  "aria-label": ariaLabel,
}: CalSelectProps) {
  const reactId = useId();
  const listId = `${id ?? reactId}-list`;

  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<Box | null>(null);

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useLayoutEffect(() => {
    setHost(btnRef.current?.closest<HTMLElement>(".cockpit") ?? document.body);
  }, []);

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const roomBelow = window.innerHeight - r.bottom - GAP - 8;
    const roomAbove = r.top - GAP - 8;
    // Flip up only when below is genuinely cramped and above is roomier.
    const up = roomBelow < 180 && roomAbove > roomBelow;
    const maxHeight = Math.max(120, Math.min(MENU_MAX_H, up ? roomAbove : roomBelow));

    const width = Math.max(r.width, 200);
    const left =
      align === "end"
        ? Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
        : Math.max(8, Math.min(r.left, window.innerWidth - width - 8));

    setBox({
      left,
      ...(up
        ? { bottom: window.innerHeight - r.top + GAP }
        : { top: r.bottom + GAP }),
      minWidth: width,
      maxHeight,
    });
  }, [align]);

  // Reposition rather than close when the page moves under an open menu —
  // closing on scroll is the thing that makes custom selects feel broken.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openMenu = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const commit = (index: number) => {
    const option = options[index];
    setOpen(false);
    btnRef.current?.focus();
    if (option && option.value !== value) onChange(option.value);
  };

  /** Jump to the next option starting with what's been typed. */
  const typeahead = (char: string) => {
    const now = Date.now();
    const text = (now - typed.current.at > TYPE_RESET_MS ? "" : typed.current.text) + char;
    typed.current = { text, at: now };

    const from = open ? active : Math.max(selectedIndex, 0);
    // Search past the current row first so repeating a letter cycles matches.
    for (let i = 1; i <= options.length; i++) {
      const idx = (from + i) % options.length;
      if (options[idx].label.toLowerCase().startsWith(text.toLowerCase())) {
        if (open) setActive(idx);
        else commit(idx);
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
        return;
      }
    } else {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          btnRef.current?.focus();
          return;
        case "ArrowDown":
          e.preventDefault();
          setActive((i) => Math.min(options.length - 1, i + 1));
          return;
        case "ArrowUp":
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
          return;
        case "Home":
          e.preventDefault();
          setActive(0);
          return;
        case "End":
          e.preventDefault();
          setActive(options.length - 1);
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          commit(active);
          return;
        case "Tab":
          setOpen(false);
          return;
      }
    }

    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      typeahead(e.key);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`cal-select${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="cal-select-value">{selected?.label ?? placeholder}</span>
        {selected?.hint && <span className="cal-select-hint">{selected.hint}</span>}
        <span className="cal-select-caret" aria-hidden="true" />
      </button>

      {open &&
        host &&
        box &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="cal-select-menu"
            style={{
              left: box.left,
              top: box.top,
              bottom: box.bottom,
              minWidth: box.minWidth,
              maxHeight: box.maxHeight,
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                className={`cal-select-opt${i === active ? " is-active" : ""}${
                  o.value === value ? " is-selected" : ""
                }`}
                onPointerEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span className="cal-select-mark" aria-hidden="true" />
                <span className="cal-select-label">{o.label}</span>
                {o.hint && <span className="cal-select-opt-hint">{o.hint}</span>}
              </div>
            ))}
          </div>,
          host
        )}
    </>
  );
}
