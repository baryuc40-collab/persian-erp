import { Op } from '@nocobase/database';
import { IRAN_REGION_OPERATOR, normalizeRegion, REGION_SEPARATOR } from '../shared/iran-regions';

// The filter operator of the province and city field (STORY-058): "اصفهان" finds "اصفهان" and every
// "اصفهان / …", while "اصفهان / کاشان" finds that city only. A plain prefix match is not enough, since one province
// name can start another («کرمان» and «کرمانشاه»).

function within(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const region = normalizeRegion(value);
  const conditions: object[] = [{ [Op.eq]: region }];
  // Names have no LIKE wildcards; a value that does is matched exactly rather than escaped per database.
  if (!/[%_\\]/.test(region)) conditions.push({ [Op.like]: `${region}${REGION_SEPARATOR}%` });
  return conditions;
}

export function iranRegionWithin(value: unknown) {
  const conditions = (Array.isArray(value) ? value : [value]).flatMap(within);
  // Nothing chosen matches nothing, like $in with an empty list.
  return conditions.length ? { [Op.or]: conditions } : { [Op.in]: [] };
}

export function registerIranRegionOperator(db: { registerOperators(operators: Record<string, unknown>): void }) {
  db.registerOperators({ [IRAN_REGION_OPERATOR]: iranRegionWithin });
}
