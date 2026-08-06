import type { MenuItem, Option, OptionGroup, OptionId } from './types.js';

/**
 * Why a selection cannot be ordered. The customer page uses these to keep the
 * Add button disabled and say what is missing; the API turns them into a 409
 * so a client that ignores its own rules still cannot get past the server.
 */
export type ViolationReason =
  | 'too_few'
  | 'too_many'
  | 'unknown_option'
  | 'option_sold_out';

export interface OptionViolation {
  reason: ViolationReason;
  groupId: string;
  groupName: string;
  /** Set for unknown_option and option_sold_out. */
  optionId?: OptionId;
  optionName?: string;
  min?: number;
  max?: number;
  chosen?: number;
}

/** Every option across every group of a dish, by id. */
export function optionIndex(item: MenuItem): Map<OptionId, Option> {
  const index = new Map<OptionId, Option>();
  for (const group of item.optionGroups) {
    for (const option of group.options) index.set(option.id, option);
  }
  return index;
}

function groupOf(item: MenuItem, optionId: OptionId): OptionGroup | undefined {
  return item.optionGroups.find((group) =>
    group.options.some((option) => option.id === optionId),
  );
}

/**
 * Checks a selection against the dish's rules. Returns every problem rather
 * than the first, so the customer fixes all of them in one pass instead of
 * being told about them one at a time.
 */
export function validateSelection(
  item: MenuItem,
  optionIds: readonly OptionId[],
): OptionViolation[] {
  const violations: OptionViolation[] = [];
  const index = optionIndex(item);
  const chosen = new Set(optionIds);

  for (const id of chosen) {
    const option = index.get(id);
    if (!option) {
      violations.push({
        reason: 'unknown_option',
        groupId: '',
        groupName: '',
        optionId: id,
      });
      continue;
    }
    if (!option.isAvailable) {
      const group = groupOf(item, id);
      violations.push({
        reason: 'option_sold_out',
        groupId: group?.id ?? '',
        groupName: group?.nameEn ?? '',
        optionId: id,
        optionName: option.nameEn,
      });
    }
  }

  for (const group of item.optionGroups) {
    const count = group.options.filter((option) => chosen.has(option.id)).length;

    if (count < group.minSelect) {
      violations.push({
        reason: 'too_few',
        groupId: group.id,
        groupName: group.nameEn,
        min: group.minSelect,
        chosen: count,
      });
    }

    if (count > group.maxSelect) {
      violations.push({
        reason: 'too_many',
        groupId: group.id,
        groupName: group.nameEn,
        max: group.maxSelect,
        chosen: count,
      });
    }
  }

  return violations;
}

export const isSelectionValid = (
  item: MenuItem,
  optionIds: readonly OptionId[],
): boolean => validateSelection(item, optionIds).length === 0;

/**
 * What a group's rule means, said the way a person would. Sits under the group
 * heading on the customer page.
 */
export function groupRuleLabel(group: OptionGroup): string {
  const { minSelect: min, maxSelect: max } = group;
  if (min === 1 && max === 1) return 'Choose one';
  if (min === 0 && max === 1) return 'Choose one, or none';
  if (min === 0) return max >= group.options.length ? 'Choose any' : `Up to ${max}`;
  if (min === max) return `Choose ${min}`;
  return `Choose ${min} to ${max}`;
}

/** Required groups are the ones that block ordering until answered. */
export const isRequired = (group: OptionGroup): boolean => group.minSelect > 0;

/** A single choice, rather than a set of independent toggles. */
export const isSingleChoice = (group: OptionGroup): boolean =>
  group.maxSelect === 1;

/**
 * The options a dish would carry with nothing chosen yet: for a required
 * pick-one group, the first available choice, so a customer who does not care
 * about spice level can still add the dish in one tap.
 */
export function defaultSelection(item: MenuItem): OptionId[] {
  const chosen: OptionId[] = [];
  for (const group of item.optionGroups) {
    if (group.minSelect < 1) continue;
    const available = group.options.filter((option) => option.isAvailable);
    for (const option of available.slice(0, group.minSelect)) {
      chosen.push(option.id);
    }
  }
  return chosen;
}
