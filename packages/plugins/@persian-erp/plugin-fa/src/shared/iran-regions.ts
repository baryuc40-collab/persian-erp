/**
 * @license Province and city names from iran-cities-json 2.0.0 (https://github.com/jd1378/iran-cities-json),
 * Copyright (c) 2020 jd1378, built on iran-cities (https://github.com/ahmadazizi/iran-cities), Copyright (c) 2017
 * Ahmad Azizi, both under the MIT License; see iran-regions.NOTICE.md.
 */

import type { IranianFieldKind } from './iranian-fields';
import { toPersianLetters } from './persian-letters';
import regions from './iran-regions.json';

// Province and city (STORY-058). A value is stored as the names people read, "اصفهان / کاشان", or a province alone,
// "اصفهان". Names keep the stored value readable in exports, charts and the API, and a province filter matches the
// province and every "province / city" under it (server/iran-regions.ts).

export interface IranProvince {
  name: string;
  cities: string[];
}

export const IRAN_PROVINCES: IranProvince[] = (regions as [string, string[]][]).map(([name, cities]) => ({
  name,
  cities,
}));

export const REGION_SEPARATOR = ' / ';

/** The filter operator "is or is within": a province also matches its cities (server/iran-regions.ts). */
export const IRAN_REGION_OPERATOR = '$iranRegionWithin';

/** The parts of a value: what people type with any spacing around the slash, Arabic letters or extra spaces. */
export function regionParts(value: string): string[] {
  return toPersianLetters(value)
    .split('/')
    .map((part) => part.replace(/\s+/g, ' ').trim());
}

export const normalizeRegion = (text: string) => regionParts(text).join(REGION_SEPARATOR);

export function findProvince(name: string) {
  return IRAN_PROVINCES.find((province) => province.name === name);
}

/** A province, or a province and one of its cities. */
export function isIranRegion(value: string) {
  const [provinceName, city, ...rest] = regionParts(value);
  const province = findProvince(provinceName);
  if (!province || rest.length) return false;
  return city === undefined || province.cities.includes(city);
}

export const IRAN_REGION_KIND: IranianFieldKind = {
  name: 'iranRegion',
  title: 'Province and city',
  error: '{{field}} is not a province and city of Iran',
  maxLength: 100,
  normalize: normalizeRegion,
  validate: isIranRegion,
};
