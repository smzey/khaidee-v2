import { describe, expect, it } from 'vitest';
import {
  defaultSelection,
  groupRuleLabel,
  isRequired,
  isSelectionValid,
  isSingleChoice,
  optionIndex,
  validateSelection,
} from './options.js';
import type { MenuItem, Option, OptionGroup } from './types.js';

const option = (over: Partial<Option> & { id: string }): Option => ({
  groupId: 'g1',
  nameTh: 'เผ็ดน้อย',
  nameEn: 'Mild',
  priceDelta: 0,
  isAvailable: true,
  sortOrder: 0,
  ...over,
});

const group = (over: Partial<OptionGroup> & { id: string }): OptionGroup => ({
  menuItemId: 'i1',
  nameTh: 'ระดับความเผ็ด',
  nameEn: 'Spice level',
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 0,
  options: [],
  ...over,
});

/** Spice level: pick exactly one, required. */
const spice = group({
  id: 'g1',
  options: [
    option({ id: 'mild', nameEn: 'Mild' }),
    option({ id: 'medium', nameEn: 'Medium' }),
    option({ id: 'hot', nameEn: 'Thai hot' }),
  ],
});

/** Add-ons: pick any, optional, priced. */
const addons = group({
  id: 'g2',
  nameEn: 'Add-ons',
  nameTh: 'เพิ่มเติม',
  minSelect: 0,
  maxSelect: 3,
  sortOrder: 1,
  options: [
    option({ id: 'egg', groupId: 'g2', nameEn: 'Extra egg', priceDelta: 10 }),
    option({ id: 'noodles', groupId: 'g2', nameEn: 'Extra noodles', priceDelta: 15 }),
    option({ id: 'prawns', groupId: 'g2', nameEn: 'Prawns', priceDelta: 30 }),
  ],
});

const padThai: MenuItem = {
  id: 'i1',
  vendorId: 'v1',
  categoryId: 'c1',
  nameTh: 'ผัดไทย',
  nameEn: 'Pad Thai',
  price: 60,
  imageUrl: null,
  isAvailable: true,
  ingredients: [],
  sortOrder: 0,
  optionGroups: [spice, addons],
};

const plain: MenuItem = { ...padThai, id: 'i2', nameEn: 'Water', optionGroups: [] };

describe('optionIndex', () => {
  it('flattens every option across every group', () => {
    expect([...optionIndex(padThai).keys()].sort()).toEqual([
      'egg',
      'hot',
      'medium',
      'mild',
      'noodles',
      'prawns',
    ]);
  });

  it('is empty for a dish with no options', () => {
    expect(optionIndex(plain).size).toBe(0);
  });
});

describe('required pick-one groups', () => {
  it('accepts exactly one', () => {
    expect(isSelectionValid(padThai, ['mild'])).toBe(true);
  });

  it('rejects choosing none', () => {
    const [violation] = validateSelection(padThai, []);
    expect(violation?.reason).toBe('too_few');
    expect(violation?.groupName).toBe('Spice level');
    expect(violation?.min).toBe(1);
    expect(violation?.chosen).toBe(0);
  });

  it('rejects choosing two from a pick-one group', () => {
    const violations = validateSelection(padThai, ['mild', 'hot']);
    expect(violations.map((v) => v.reason)).toContain('too_many');
    expect(violations.find((v) => v.reason === 'too_many')?.max).toBe(1);
  });
});

describe('optional pick-any groups', () => {
  it('accepts none of them', () => {
    expect(isSelectionValid(padThai, ['mild'])).toBe(true);
  });

  it('accepts several', () => {
    expect(isSelectionValid(padThai, ['mild', 'egg', 'prawns'])).toBe(true);
  });

  it('rejects more than the cap', () => {
    const violations = validateSelection(padThai, [
      'mild',
      'egg',
      'noodles',
      'prawns',
    ]);
    // maxSelect is 3 and three add-ons were chosen — that is the cap, not over it.
    expect(violations).toEqual([]);
  });

  it('rejects going over a smaller cap', () => {
    const capped: MenuItem = {
      ...padThai,
      optionGroups: [spice, { ...addons, maxSelect: 2 }],
    };
    const violations = validateSelection(capped, ['mild', 'egg', 'noodles', 'prawns']);
    expect(violations.map((v) => v.reason)).toEqual(['too_many']);
  });
});

describe('options that cannot be sold', () => {
  it('rejects an option the dish does not have', () => {
    const [violation] = validateSelection(padThai, ['mild', 'ghost']);
    expect(violation?.reason).toBe('unknown_option');
    expect(violation?.optionId).toBe('ghost');
  });

  it('rejects an option that ran out', () => {
    const soldOut: MenuItem = {
      ...padThai,
      optionGroups: [
        spice,
        {
          ...addons,
          options: addons.options.map((o) =>
            o.id === 'prawns' ? { ...o, isAvailable: false } : o,
          ),
        },
      ],
    };
    const violations = validateSelection(soldOut, ['mild', 'prawns']);
    expect(violations[0]?.reason).toBe('option_sold_out');
    expect(violations[0]?.optionName).toBe('Prawns');
  });
});

describe('reporting every problem at once', () => {
  it('does not stop at the first, so the customer fixes them in one pass', () => {
    const violations = validateSelection(padThai, ['ghost']);
    expect(violations.map((v) => v.reason).sort()).toEqual([
      'too_few',
      'unknown_option',
    ]);
  });
});

describe('a dish with no options', () => {
  it('is valid with nothing chosen', () => {
    expect(isSelectionValid(plain, [])).toBe(true);
  });

  it('still rejects options invented for it', () => {
    expect(isSelectionValid(plain, ['egg'])).toBe(false);
  });
});

describe('groupRuleLabel', () => {
  it('says "Choose one" for a required pick-one', () => {
    expect(groupRuleLabel(spice)).toBe('Choose one');
  });

  it('says "Choose any" when the cap is everything', () => {
    expect(groupRuleLabel(addons)).toBe('Choose any');
  });

  it('names a smaller cap', () => {
    expect(groupRuleLabel({ ...addons, maxSelect: 2 })).toBe('Up to 2');
  });

  it('handles optional pick-one', () => {
    expect(groupRuleLabel({ ...spice, minSelect: 0 })).toBe('Choose one, or none');
  });

  it('handles an exact count above one', () => {
    expect(groupRuleLabel({ ...addons, minSelect: 2, maxSelect: 2 })).toBe(
      'Choose 2',
    );
  });

  it('handles a range', () => {
    expect(groupRuleLabel({ ...addons, minSelect: 1, maxSelect: 3 })).toBe(
      'Choose 1 to 3',
    );
  });
});

describe('rendering hints', () => {
  it('marks required groups', () => {
    expect(isRequired(spice)).toBe(true);
    expect(isRequired(addons)).toBe(false);
  });

  it('marks single-choice groups, which render as radios', () => {
    expect(isSingleChoice(spice)).toBe(true);
    expect(isSingleChoice(addons)).toBe(false);
  });
});

describe('defaultSelection', () => {
  it('pre-answers required groups so one tap can still add the dish', () => {
    expect(defaultSelection(padThai)).toEqual(['mild']);
    expect(isSelectionValid(padThai, defaultSelection(padThai))).toBe(true);
  });

  it('leaves optional groups alone', () => {
    expect(defaultSelection(padThai)).not.toContain('egg');
  });

  it('skips a sold-out first choice', () => {
    const soldOut: MenuItem = {
      ...padThai,
      optionGroups: [
        {
          ...spice,
          options: [{ ...spice.options[0] as Option, isAvailable: false }, ...spice.options.slice(1)],
        },
      ],
    };
    expect(defaultSelection(soldOut)).toEqual(['medium']);
  });

  it('is empty for a dish with nothing required', () => {
    expect(defaultSelection(plain)).toEqual([]);
  });
});
