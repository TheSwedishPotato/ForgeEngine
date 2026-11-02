import { build as garage } from './garage.js';
import { build as cathedral } from './cathedral.js';
import { build as roof } from './roof.js';
import { build as harbour } from './harbour.js';

/** Every set of the episode by the names the script uses. */
export const SETS = {
  garage: (o) => garage(o),
  cathedral: (o) => cathedral(o),
  garageRoof: (o) => roof(o),
  harbour: (o) => harbour({ ...o, staging: 'harbour' }),
  acheron: (o) => harbour({ ...o, staging: 'acheron' }),
};
