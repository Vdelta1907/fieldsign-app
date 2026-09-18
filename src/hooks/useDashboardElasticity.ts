import { useLayoutEffect, useRef } from 'react';

// Visual feedback only: never change document or orders scroll positions.
export function useDashboardElasticity(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let startY: number | null = null;
    let offset = 0;
    let dragged = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      startY = null;
      offset = 0;
      element.classList.add('elastic-return');
      element.style.transform = '';
    };
    const move = (distance: number) => {
      if (motion?.matches) return;
      // Resistance increases with distance, with a hard visual limit of 12px.
      offset = distance;
      element.classList.remove('elastic-return');
      element.style.transform = `translateY(${12 * Math.tanh(distance / 90)}px)`;
    };
    const start = (event: TouchEvent) => {
      dragged = false;
      clearTimeout(timer);
      startY = event.touches.length === 1 ? event.touches[0].clientY : null;
      if (startY === null) settle();
    };
    const touch = (event: TouchEvent) => {
      if (event.touches.length !== 1) { settle(); return; }
      if (startY === null) return;
      const distance = event.touches[0].clientY - startY;
      if (Math.abs(distance) < 5 && !dragged) return;
      dragged = true;
      if (event.cancelable) event.preventDefault();
      move(distance);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.cancelable) event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      move(Math.max(-360, Math.min(360, offset - event.deltaY * unit)));
      clearTimeout(timer);
      timer = setTimeout(settle, 100);
    };
    const click = (event: MouseEvent) => {
      if (dragged && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
        dragged = false;
      }
    };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', touch, { passive: false });
    element.addEventListener('touchend', settle);
    element.addEventListener('touchcancel', settle);
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('click', click, true);
    motion?.addEventListener('change', settle);
    return () => {
      clearTimeout(timer);
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', touch);
      element.removeEventListener('touchend', settle);
      element.removeEventListener('touchcancel', settle);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('click', click, true);
      motion?.removeEventListener('change', settle);
      element.classList.remove('elastic-return');
      element.style.transform = '';
    };
  }, [enabled]);
  return ref;
}
