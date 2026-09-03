import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimeSlider from './TimeSlider';

const baseTime = new Date();
const steps = [
  { time: baseTime.toISOString(), wind: { speedMs: 4.5, directionDeg: 120 }, conditions: { tempC: 12 } },
  { time: new Date(baseTime.getTime() + 3600 * 1000).toISOString(), wind: { speedMs: 5.2, directionDeg: 130 }, conditions: { tempC: 11 } },
  { time: new Date(baseTime.getTime() + 2 * 3600 * 1000).toISOString(), wind: { speedMs: 3.9, directionDeg: 110 }, conditions: { tempC: 11 } },
];

describe('TimeSlider', () => {
  it('renders the forecast slider and current wind speed', () => {
    const { unmount } = render(<TimeSlider steps={steps} index={0} onChange={vi.fn()} isMobile={false} lat={55.68} lon={12.57} />);
    const slider = screen.getAllByRole('slider', { name: 'Forecast time' })[0];
    expect(slider).toBeDefined();
    // The speed is in a nested span, so we need a more flexible query.
    expect(screen.getByText((_content, node) => {
      const hasText = (element: Element | Text | null) => element?.textContent?.includes("4.5") && element?.textContent?.includes("m/s");
      const nodeHasText = hasText(node);
      const childrenDontHaveText = Array.from(node?.children || []).every(
        (child) => !hasText(child)
      );
      return !!(nodeHasText && childrenDontHaveText);
    })).toBeDefined();
    expect(screen.getByText((content) => content.includes('+2') && content.includes('h'))).toBeDefined();
    unmount();
  });

  it('calls onChange when the slider value changes', () => {
    const onChange = vi.fn();
    const { unmount } = render(<TimeSlider steps={steps} index={0} onChange={onChange} isMobile={false} lat={55.68} lon={12.57} />);
    const slider = screen.getAllByRole('slider', { name: 'Forecast time' })[0] as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(2);
    unmount();
  });
});
