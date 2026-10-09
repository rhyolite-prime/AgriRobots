import { defineEventHandler } from 'h3';

import { ARACNID } from '@agrirobots/engine';

import { ARACNID_FAULT_KINDS, ARACNID_SCENARIOS, NEST_LAYOUTS } from '../../shared/scenarios';

/**
 * What the lab may ask the ARACNID world to do, and the geometry it will draw.
 * The browser builds its pickers from this, so it cannot offer a scenario the
 * engine does not model.
 */
export default defineEventHandler(() => {
  return {
    scenarios: ARACNID_SCENARIOS.map((scenario) => ({ ...scenario })),
    faults: ARACNID_FAULT_KINDS.map((fault) => ({ ...fault })),
    layouts: NEST_LAYOUTS.map((layout) => ({ ...layout })),
    geometry: { ...ARACNID },
  };
});
