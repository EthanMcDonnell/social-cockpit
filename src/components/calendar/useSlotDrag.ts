"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pointer-driven dragging for calendar cards.
 *
 * Deliberately not HTML5 drag-and-drop: that API gives you a browser-rendered
 * ghost you can't style, no control over the drop preview, and no way to
 * auto-scroll a container smoothly. Pointer events cost a little more code and
 * buy a drag that actually tracks the finger.
 *
 * Native DnD is still used for *files* dropped from the desktop — that's the one
 * thing pointer events can't see. The two coexist on the same grid.
 *
 * Three things make this feel right rather than merely work:
 *   1. A movement threshold, so a click that wobbles two pixels is still a click.
 *   2. Pointer moves batched into one rAF, so a 1000 Hz mouse can't outrun React.
 *   3. Edge auto-scroll, so a card can be dragged to a time that's off-screen.
 */

const DRAG_THRESHOLD_PX = 4;
/** Distance from a scroll edge at which auto-scroll kicks in. */
const EDGE_PX = 56;
const MAX_EDGE_SPEED = 18;

export interface DragState {
  id: string;
  /** Viewport position of the proxy's top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The slot under the pointer, as epoch ms. Null when outside the grid. */
  target: number | null;
}

interface Options {
  /** Map a viewport point to a scheduled_at, or null if it isn't over a slot. */
  resolveSlot: (clientX: number, clientY: number) => number | null;
  /** Called once, on release, when the slot actually changed. */
  onCommit: (id: string, scheduledAt: number) => void;
  /** Scrolling element to auto-scroll near the edges. */
  scrollRef?: React.RefObject<HTMLElement>;
  /** Suppress dragging (e.g. a job that's mid-publish). */
  canDrag?: (id: string) => boolean;
}

export function useSlotDrag({ resolveSlot, onCommit, scrollRef, canDrag }: Options) {
  const [drag, setDrag] = useState<DragState | null>(null);

  // Everything the move handler needs lives in a ref: re-subscribing window
  // listeners on every pointermove would be its own source of stutter.
  const session = useRef<{
    id: string;
    grabX: number;
    grabY: number;
    width: number;
    height: number;
    startX: number;
    startY: number;
    origin: number;
    active: boolean;
    pointerX: number;
    pointerY: number;
  } | null>(null);

  const frame = useRef<number | null>(null);
  const edgeTimer = useRef<number | null>(null);

  const stopEdgeScroll = () => {
    if (edgeTimer.current != null) {
      cancelAnimationFrame(edgeTimer.current);
      edgeTimer.current = null;
    }
  };

  /** Scroll the container while the pointer sits near its top or bottom edge. */
  const runEdgeScroll = useCallback(() => {
    const el = scrollRef?.current;
    const s = session.current;
    if (!el || !s || !s.active) {
      stopEdgeScroll();
      return;
    }

    const rect = el.getBoundingClientRect();
    const fromTop = s.pointerY - rect.top;
    const fromBottom = rect.bottom - s.pointerY;

    let delta = 0;
    if (fromTop < EDGE_PX) delta = -Math.ceil(((EDGE_PX - fromTop) / EDGE_PX) * MAX_EDGE_SPEED);
    else if (fromBottom < EDGE_PX)
      delta = Math.ceil(((EDGE_PX - fromBottom) / EDGE_PX) * MAX_EDGE_SPEED);

    if (delta !== 0) {
      el.scrollTop += delta;
      // The slot under a stationary pointer changes as the content moves.
      const target = resolveSlot(s.pointerX, s.pointerY);
      setDrag((d) => (d ? { ...d, target } : d));
    }

    edgeTimer.current = requestAnimationFrame(runEdgeScroll);
  }, [resolveSlot, scrollRef]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const s = session.current;
      if (!s) return;

      s.pointerX = e.clientX;
      s.pointerY = e.clientY;

      if (!s.active) {
        const moved = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (moved < DRAG_THRESHOLD_PX) return;
        s.active = true;
        document.body.classList.add("cal-dragging");
        if (scrollRef?.current) edgeTimer.current = requestAnimationFrame(runEdgeScroll);
      }

      // One state update per frame, whatever the pointer's report rate.
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const cur = session.current;
        if (!cur) return;
        setDrag({
          id: cur.id,
          x: cur.pointerX - cur.grabX,
          y: cur.pointerY - cur.grabY,
          width: cur.width,
          height: cur.height,
          target: resolveSlot(cur.pointerX, cur.pointerY),
        });
      });
    }

    function onUp() {
      const s = session.current;
      session.current = null;
      stopEdgeScroll();
      if (frame.current != null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      document.body.classList.remove("cal-dragging");

      if (s?.active) {
        const target = resolveSlot(s.pointerX, s.pointerY);
        if (target != null && target !== s.origin) onCommit(s.id, target);
      }
      setDrag(null);
    }

    function onCancel() {
      session.current = null;
      stopEdgeScroll();
      document.body.classList.remove("cal-dragging");
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      stopEdgeScroll();
      document.body.classList.remove("cal-dragging");
    };
  }, [onCommit, resolveSlot, runEdgeScroll, scrollRef]);

  const startDrag = useCallback(
    (e: React.PointerEvent, id: string, origin: number) => {
      // Left button / touch / pen only, and never on an interactive child.
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
      if (canDrag && !canDrag(id)) return;

      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      session.current = {
        id,
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        startX: e.clientX,
        startY: e.clientY,
        pointerX: e.clientX,
        pointerY: e.clientY,
        origin,
        active: false,
      };
    },
    [canDrag]
  );

  return { drag, startDrag, isDragging: drag !== null };
}
