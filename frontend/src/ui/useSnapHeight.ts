import { useLayoutEffect, useRef } from "react";

const CELL = 24;

/** Smallest whole number of cells that holds `px`. */
export const roundUpToCell = (px: number, cell = CELL) => Math.ceil(Math.round(px * 100) / 100 / cell) * cell;

/**
 * Keeps a panel's outer height on whole cells while its text keeps a normal line-height:
 * the panel's min-height is its natural height rounded up to the next cell. The first child
 * is measured, so the added height never feeds back into the measurement.
 */
export function useSnapHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const inner = el?.firstElementChild as HTMLElement | null;
    if (!el || !inner) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      el.style.minHeight = `${roundUpToCell(inner.getBoundingClientRect().height + chrome)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  return ref;
}
