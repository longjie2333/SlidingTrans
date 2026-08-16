import type { SelectionSnapshot, TriggerMode, ViewportRect } from "../shared/types";

export interface TriggerPoint {
  left: number;
  top: number;
}

export interface ModalPlacement {
  left: number;
  top: number;
  placement: "top" | "bottom";
  width: number;
}

export function getTriggerPoint(selection: SelectionSnapshot, mode: TriggerMode): TriggerPoint {
  const offset = mode === "icon" ? 20 : 10;
  const rect = selection.rect;
  return {
    left: Math.min(window.innerWidth - offset, Math.max(offset, rect.right)),
    top: Math.min(window.innerHeight - offset, Math.max(offset, rect.bottom + offset)),
  };
}

export function getModalPlacement(
  rect: ViewportRect,
  modalWidth = Math.min(450, Math.max(280, window.innerWidth - 24)),
  modalHeight = 260,
): ModalPlacement {
  const margin = 12;
  const gap = 10;
  const width = Math.min(modalWidth, window.innerWidth - margin * 2);
  const preferredLeft = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, preferredLeft));
  const belowTop = rect.bottom + gap;
  const aboveTop = rect.top - modalHeight - gap;
  const placement = belowTop + modalHeight <= window.innerHeight - margin || aboveTop < margin ? "bottom" : "top";
  const rawTop = placement === "bottom" ? belowTop : aboveTop;
  const top = Math.max(margin, Math.min(window.innerHeight - modalHeight - margin, rawTop));
  return { left, top, placement, width };
}
