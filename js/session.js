/* Starting a workout has one rule worth centralising: never silently throw away
   a session that is already in progress. */

import { menuSheet, confirmSheet } from './util.js';
import { settings, startWorkout, discardWorkout } from './state.js';
import { navigate } from './router.js';
import { stopRest } from './rest.js';

export function beginWorkout(routine = null) {
  if (!settings.active) {
    startWorkout(routine);
    navigate('workout');
    return;
  }
  menuSheet('A workout is already running', [
    { label: `Resume “${settings.active.name}”`, onPick: () => navigate('workout') },
    {
      label: 'Discard it and start this one',
      danger: true,
      onPick: async () => {
        const ok = await confirmSheet({
          title: 'Discard current workout',
          message: 'Everything logged in the running session will be lost.',
          confirmLabel: 'Discard', danger: true,
        });
        if (!ok) return;
        stopRest();
        discardWorkout();
        startWorkout(routine);
        navigate('workout');
      },
    },
  ]);
}
