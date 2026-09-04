/* Built-in exercise catalogue.
 *
 * The app has to be fully usable with no API key and no network — you can walk
 * into a gym, open it and log a session. ExerciseDB then layers animations and
 * its 11k-exercise catalogue on top of this list rather than replacing it.
 *
 * Columns: name, body part, primary muscle, equipment.
 */

const TABLE = [
  // ---- Chest
  ['Barbell Bench Press', 'Chest', 'Pectoralis major', 'Barbell'],
  ['Incline Barbell Bench Press', 'Chest', 'Upper chest', 'Barbell'],
  ['Dumbbell Bench Press', 'Chest', 'Pectoralis major', 'Dumbbell'],
  ['Incline Dumbbell Press', 'Chest', 'Upper chest', 'Dumbbell'],
  ['Decline Bench Press', 'Chest', 'Lower chest', 'Barbell'],
  ['Machine Chest Press', 'Chest', 'Pectoralis major', 'Machine'],
  ['Pec Deck Fly', 'Chest', 'Pectoralis major', 'Machine'],
  ['Cable Chest Fly', 'Chest', 'Pectoralis major', 'Cable'],
  ['Dumbbell Fly', 'Chest', 'Pectoralis major', 'Dumbbell'],
  ['Push-Up', 'Chest', 'Pectoralis major', 'Bodyweight'],
  ['Chest Dip', 'Chest', 'Lower chest', 'Bodyweight'],

  // ---- Back
  ['Deadlift', 'Back', 'Erector spinae', 'Barbell'],
  ['Barbell Row', 'Back', 'Latissimus dorsi', 'Barbell'],
  ['Pendlay Row', 'Back', 'Latissimus dorsi', 'Barbell'],
  ['Dumbbell Row', 'Back', 'Latissimus dorsi', 'Dumbbell'],
  ['Chest Supported Row', 'Back', 'Rhomboids', 'Machine'],
  ['T-Bar Row', 'Back', 'Latissimus dorsi', 'Machine'],
  ['Seated Cable Row', 'Back', 'Latissimus dorsi', 'Cable'],
  ['Lat Pulldown', 'Back', 'Latissimus dorsi', 'Cable'],
  ['Close Grip Lat Pulldown', 'Back', 'Latissimus dorsi', 'Cable'],
  ['Pull-Up', 'Back', 'Latissimus dorsi', 'Bodyweight'],
  ['Chin-Up', 'Back', 'Latissimus dorsi', 'Bodyweight'],
  ['Straight Arm Pulldown', 'Back', 'Latissimus dorsi', 'Cable'],
  ['Face Pull', 'Back', 'Rear deltoid', 'Cable'],
  ['Back Extension', 'Back', 'Erector spinae', 'Bodyweight'],
  ['Shrug', 'Back', 'Trapezius', 'Barbell'],
  ['Dumbbell Shrug', 'Back', 'Trapezius', 'Dumbbell'],

  // ---- Legs
  ['Back Squat', 'Legs', 'Quadriceps', 'Barbell'],
  ['Front Squat', 'Legs', 'Quadriceps', 'Barbell'],
  ['Hack Squat', 'Legs', 'Quadriceps', 'Machine'],
  ['Leg Press', 'Legs', 'Quadriceps', 'Machine'],
  ['Bulgarian Split Squat', 'Legs', 'Quadriceps', 'Dumbbell'],
  ['Walking Lunge', 'Legs', 'Quadriceps', 'Dumbbell'],
  ['Goblet Squat', 'Legs', 'Quadriceps', 'Dumbbell'],
  ['Leg Extension', 'Legs', 'Quadriceps', 'Machine'],
  ['Romanian Deadlift', 'Legs', 'Hamstrings', 'Barbell'],
  ['Stiff Leg Deadlift', 'Legs', 'Hamstrings', 'Barbell'],
  ['Leg Curl', 'Legs', 'Hamstrings', 'Machine'],
  ['Seated Leg Curl', 'Legs', 'Hamstrings', 'Machine'],
  ['Nordic Curl', 'Legs', 'Hamstrings', 'Bodyweight'],
  ['Hip Thrust', 'Legs', 'Gluteus maximus', 'Barbell'],
  ['Glute Bridge', 'Legs', 'Gluteus maximus', 'Bodyweight'],
  ['Cable Kickback', 'Legs', 'Gluteus maximus', 'Cable'],
  ['Hip Abduction', 'Legs', 'Gluteus medius', 'Machine'],
  ['Standing Calf Raise', 'Legs', 'Gastrocnemius', 'Machine'],
  ['Seated Calf Raise', 'Legs', 'Soleus', 'Machine'],

  // ---- Shoulders
  ['Overhead Press', 'Shoulders', 'Anterior deltoid', 'Barbell'],
  ['Seated Dumbbell Shoulder Press', 'Shoulders', 'Anterior deltoid', 'Dumbbell'],
  ['Arnold Press', 'Shoulders', 'Anterior deltoid', 'Dumbbell'],
  ['Machine Shoulder Press', 'Shoulders', 'Anterior deltoid', 'Machine'],
  ['Dumbbell Lateral Raise', 'Shoulders', 'Lateral deltoid', 'Dumbbell'],
  ['Cable Lateral Raise', 'Shoulders', 'Lateral deltoid', 'Cable'],
  ['Machine Lateral Raise', 'Shoulders', 'Lateral deltoid', 'Machine'],
  ['Reverse Pec Deck', 'Shoulders', 'Rear deltoid', 'Machine'],
  ['Bent Over Reverse Fly', 'Shoulders', 'Rear deltoid', 'Dumbbell'],
  ['Upright Row', 'Shoulders', 'Lateral deltoid', 'Barbell'],
  ['Front Raise', 'Shoulders', 'Anterior deltoid', 'Dumbbell'],

  // ---- Arms
  ['Dumbbell Biceps Curl', 'Arms', 'Biceps brachii', 'Dumbbell'],
  ['Barbell Curl', 'Arms', 'Biceps brachii', 'Barbell'],
  ['EZ Bar Curl', 'Arms', 'Biceps brachii', 'Barbell'],
  ['Hammer Curl', 'Arms', 'Brachialis', 'Dumbbell'],
  ['Incline Dumbbell Curl', 'Arms', 'Biceps brachii', 'Dumbbell'],
  ['Preacher Curl', 'Arms', 'Biceps brachii', 'Machine'],
  ['Cable Curl', 'Arms', 'Biceps brachii', 'Cable'],
  ['Concentration Curl', 'Arms', 'Biceps brachii', 'Dumbbell'],
  ['Triceps Pushdown', 'Arms', 'Triceps brachii', 'Cable'],
  ['Rope Triceps Pushdown', 'Arms', 'Triceps brachii', 'Cable'],
  ['Overhead Cable Triceps Extension', 'Arms', 'Triceps brachii', 'Cable'],
  ['Skull Crusher', 'Arms', 'Triceps brachii', 'Barbell'],
  ['Close Grip Bench Press', 'Arms', 'Triceps brachii', 'Barbell'],
  ['Triceps Dip', 'Arms', 'Triceps brachii', 'Bodyweight'],
  ['Dumbbell Kickback', 'Arms', 'Triceps brachii', 'Dumbbell'],
  ['Wrist Curl', 'Arms', 'Forearm flexors', 'Dumbbell'],
  ['Reverse Curl', 'Arms', 'Brachioradialis', 'Barbell'],
  ['Farmer Carry', 'Arms', 'Forearm flexors', 'Dumbbell'],

  // ---- Core
  ['Plank', 'Core', 'Rectus abdominis', 'Bodyweight'],
  ['Side Plank', 'Core', 'Obliques', 'Bodyweight'],
  ['Hanging Leg Raise', 'Core', 'Rectus abdominis', 'Bodyweight'],
  ['Cable Crunch', 'Core', 'Rectus abdominis', 'Cable'],
  ['Crunch', 'Core', 'Rectus abdominis', 'Bodyweight'],
  ['Ab Wheel Rollout', 'Core', 'Rectus abdominis', 'Other'],
  ['Russian Twist', 'Core', 'Obliques', 'Other'],
  ['Pallof Press', 'Core', 'Obliques', 'Cable'],
  ['Dead Bug', 'Core', 'Rectus abdominis', 'Bodyweight'],
  ['Machine Crunch', 'Core', 'Rectus abdominis', 'Machine'],

  // ---- Olympic & power
  ['Power Clean', 'Olympic', 'Full body', 'Barbell'],
  ['Hang Clean', 'Olympic', 'Full body', 'Barbell'],
  ['Clean and Jerk', 'Olympic', 'Full body', 'Barbell'],
  ['Snatch', 'Olympic', 'Full body', 'Barbell'],
  ['Push Press', 'Olympic', 'Anterior deltoid', 'Barbell'],
  ['Kettlebell Swing', 'Olympic', 'Gluteus maximus', 'Kettlebell'],
  ['Box Jump', 'Olympic', 'Quadriceps', 'Bodyweight'],

  // ---- Cardio
  ['Treadmill Run', 'Cardio', 'Cardiovascular', 'Machine'],
  ['Stationary Bike', 'Cardio', 'Cardiovascular', 'Machine'],
  ['Rowing Machine', 'Cardio', 'Cardiovascular', 'Machine'],
  ['Stair Climber', 'Cardio', 'Cardiovascular', 'Machine'],
  ['Elliptical', 'Cardio', 'Cardiovascular', 'Machine'],
  ['Jump Rope', 'Cardio', 'Cardiovascular', 'Other'],
  ['Incline Walk', 'Cardio', 'Cardiovascular', 'Machine'],
];

export const slugify = (name) =>
  'sx-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const SEED_EXERCISES = TABLE.map(([name, bodyPart, target, equipment]) => ({
  id: slugify(name),
  name,
  bodyPart,
  target,
  equipment,
  builtin: true,
}));

export const BODY_PARTS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Olympic', 'Cardio'];

export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Other'];

/** Grouping used by the weekly "sets per muscle group" breakdown. */
export const MUSCLE_GROUP = {
  Chest: 'Chest', Back: 'Back', Legs: 'Legs', Shoulders: 'Shoulders',
  Arms: 'Arms', Core: 'Core', Olympic: 'Full body', Cardio: 'Cardio',
};
