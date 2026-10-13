// Workflows run without a user, so there is no X-Calendar header (STORY-042) to say which calendar "this month" means.
// When the administrator made Jalali the system's default calendar (STORY-048), the workflow date range variables
// ({{$system.dateRange.thisMonth}} and the other week, month, quarter and year ranges) are Jalali (STORY-049). Day
// ranges (today, last7Days) are the same in every calendar and stay NocoBase's own.
//
// plugin-workflow keeps these functions in a Registry that refuses to register a name twice unless its public
// options.override flag is set, so the flag is turned on just while the ranges are replaced.

import { CALENDAR_PRESETS, jalaliDateVar } from '../shared/jalali-ranges';

type RangeFunction = (this: unknown) => unknown;

interface WorkflowPlugin {
  functions: {
    options: { override: boolean };
    get(name: string): RangeFunction | undefined;
    register(name: string, fn: RangeFunction): void;
  };
}

// The server's own offset, which plugin-workflow uses for its ranges too.
export function serverTimezone(now = new Date()) {
  const offset = -now.getTimezoneOffset();
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Wraps the workflow date range functions; returns false when plugin-workflow is not there. */
export function installJalaliWorkflowRanges(
  workflow: WorkflowPlugin | undefined,
  calendar: () => 'jalali' | 'gregory',
) {
  const functions = workflow?.functions;
  if (!functions) return false;
  const { override } = functions.options;
  functions.options.override = true;
  try {
    for (const preset of CALENDAR_PRESETS) {
      const name = `dateRange.${preset}`;
      const original = functions.get(name);
      if (!original) continue;
      functions.register(name, function (this: unknown) {
        if (calendar() !== 'jalali') return original.call(this);
        const now = new Date();
        return jalaliDateVar(preset, serverTimezone(now), now);
      });
    }
  } finally {
    functions.options.override = override;
  }
  return true;
}
