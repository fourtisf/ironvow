/**
 * @ironvow/sim — the shared, deterministic battle simulation.
 *
 * Imported by both apps/web (to render the fight live) and apps/api (to decide
 * what it was worth). This is the anti-cheat core: because the server runs the
 * same code on the same inputs, the client has nothing to lie about beyond its
 * own deploy commands, and those are validated here too.
 */
export {
  createBattle,
  simulate,
  simulateRaid,
  type Battle,
  type SimOptions,
  type SimOutcome,
  type SimProj,
  type SimStruct,
  type SimUnit,
} from './simulate.js';
export { mulberry, randomSeed, seedToInt32, type Rng } from './rng.js';
export { generateBase, generateOpponent, generateDefendWave, garrisonName } from './generate.js';
export { Checksum } from './hash.js';
