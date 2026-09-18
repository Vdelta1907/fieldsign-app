import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useDashboardElasticity } from '../src/hooks/useDashboardElasticity';
function Dashboard({ enabled = true }) {
  const ref = useDashboardElasticity(enabled);
  return <div ref={ref} data-testid="dashboard"><button>Category</button></div>;
}
function setup(reduced = false) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  return render(<Dashboard />);
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
test('touch drag is resisted, capped, and returns on release or cancellation', () => {
  const { getByTestId } = setup();
  const el = getByTestId('dashboard');
  fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
  const distance = Number(el.style.transform.match(/translateY\((.*)px\)/)?.[1]);
  expect(distance).toBeGreaterThan(0);
  expect(distance).toBeLessThanOrEqual(12);
  expect(el.scrollTop).toBe(0);
  fireEvent.touchEnd(el);
  expect(el.style.transform).toBe('');
  expect(el.classList.contains('elastic-return')).toBe(true);
  fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientY: 0 }] });
  expect(el.style.transform).toContain('translateY(-');
  fireEvent.touchCancel(el);
  expect(el.style.transform).toBe('');
});
test('wheel feedback settles and opening a category removes gesture interception', () => {
  vi.useFakeTimers();
  const { getByTestId, rerender } = setup();
  const el = getByTestId('dashboard');
  expect(fireEvent.wheel(el, { deltaY: 80 })).toBe(false);
  expect(el.style.transform).toContain('translateY(-');
  vi.advanceTimersByTime(100);
  expect(el.style.transform).toBe('');
  fireEvent.wheel(el, { deltaY: -80 });
  rerender(<Dashboard enabled={false} />);
  expect(el.style.transform).toBe('');
  expect(fireEvent.wheel(el, { deltaY: 80 })).toBe(true);
  expect(el.style.transform).toBe('');
});
test('taps work, but a drag does not activate a category', () => {
  const { getByRole } = setup();
  const button = getByRole('button');
  const clicked = vi.fn();
  button.addEventListener('click', clicked);
  fireEvent.touchStart(button, { touches: [{ clientY: 100 }] });
  fireEvent.touchEnd(button);
  fireEvent.click(button, { detail: 1 });
  expect(clicked).toHaveBeenCalledTimes(1);
  fireEvent.touchStart(button, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(button, { touches: [{ clientY: 180 }] });
  fireEvent.touchEnd(button);
  fireEvent.click(button, { detail: 1 });
  expect(clicked).toHaveBeenCalledTimes(1);
});
test('reduced motion and pinch zoom do not animate', () => {
  const { getByTestId } = setup(true);
  const el = getByTestId('dashboard');
  fireEvent.wheel(el, { deltaY: 80 });
  expect(el.style.transform).toBe('');
  expect(fireEvent.wheel(el, { deltaY: 80, ctrlKey: true })).toBe(true);
});
