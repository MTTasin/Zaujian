// Bangladesh Division -> District -> Thana data (from Sharanga-Kinera).
import Barishal from "./Barishal.json";
import Chattogram from "./Chattogram.json";
import Dhaka from "./Dhaka.json";
import Khulna from "./Khulna.json";
import Mymensingh from "./Mymensingh.json";
import Rajshahi from "./Rajshahi.json";
import Rangpur from "./Rangpur.json";
import Sylhet from "./Sylhet.json";

export type BdLocations = Record<string, Record<string, string[]>>;

export const BD_LOCATIONS: BdLocations = {
  ...Barishal,
  ...Chattogram,
  ...Dhaka,
  ...Khulna,
  ...Mymensingh,
  ...Rajshahi,
  ...Rangpur,
  ...Sylhet,
} as BdLocations;
