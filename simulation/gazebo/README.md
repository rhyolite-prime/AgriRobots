# simulation/gazebo

Gazebo Harmonic worlds, robot descriptions, scenarios and fault injection.

**Status:** placeholder. Recordings are ignored by Git; only worlds, descriptions,
scenario definitions and expected event traces are committed.

## First worlds to build

1. Surveyed indoor corridor with the measured narrowest aisle and doorway.
2. Feed lane with commissioned stations and docking tolerances.
3. Service bay for cleaning, cassette exchange and charging.
4. Guarded field plot with crop rows, exclusion zones and variable lighting.

## Required scenario coverage

Nominal route and dock, plus: localisation loss, sensor contamination, latch or
module-ID mismatch, motion heartbeat loss, tool MCU heartbeat loss, protective
stop, overspeed, low battery, thermal fault, tool timeout, dose disagreement and
network outage. Each scenario commits its expected `JournalEvent` trace so a
regression is a diff, not an opinion.

## Rules

- Use the exported twin specification and URDF from the Virtual Lab pipeline; do
  not hand-edit a second copy of the robot description.
- Mass, inertia and CG must come from the measured database, not catalogue values.
- Sensor models must record their quality/uncertainty so a degraded simulation
  cannot look like a healthy robot.
