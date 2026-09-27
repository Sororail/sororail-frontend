import * as React from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

(globalThis as unknown as { React: typeof React }).React = React;

import { Schedule } from "../src/components/Schedule";

describe("Schedule accessibility", () => {
  it("renders progressbar with proper ARIA attributes", () => {
    const html = renderToString(
      createElement(Schedule, {
        start: 1_000_000n,
        end: 2_000_000n,
        now: 1_500_000n,
      }),
    );

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-label="Schedule progress"');
    expect(html).toContain('aria-valuetext="50% through schedule"');
  });

  it("renders marks with role='img', aria-label and in sorted DOM order", () => {
    const marks = [
      { at: 1_800_000n, label: "end cliff" },
      { at: 1_200_000n, label: "start cliff" },
    ];

    const html = renderToString(
      createElement(Schedule, {
        start: 1_000_000n,
        end: 2_000_000n,
        now: 1_500_000n,
        marks,
      }),
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="start cliff marker at');
    expect(html).toContain('aria-label="end cliff marker at');
    expect(html).toContain('aria-hidden="true"');

    // Verify chronological DOM reading order: start cliff comes before end cliff
    const startCliffIndex = html.indexOf("start cliff marker at");
    const endCliffIndex = html.indexOf("end cliff marker at");
    expect(startCliffIndex).toBeGreaterThan(-1);
    expect(endCliffIndex).toBeGreaterThan(-1);
    expect(startCliffIndex).toBeLessThan(endCliffIndex);
  });
});
