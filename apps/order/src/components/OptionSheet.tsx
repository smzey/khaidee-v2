import {
  type MenuItem,
  type Option,
  type OptionGroup,
  defaultSelection,
  formatBaht,
  formatDelta,
  groupRuleLabel,
  isRequired,
  isSelectionValid,
  isSingleChoice,
} from '@khaidee/domain';
import { useMemo, useState } from 'react';

/**
 * Asks a dish's questions before it goes in the cart.
 *
 * Required groups start pre-answered with their first available choice, so a
 * customer who does not care about spice level can still get to Add in one
 * tap. The Add button stays disabled until every rule is satisfied — the
 * server enforces the same rules, but the customer should never get as far as
 * being refused.
 */
export function OptionSheet({
  item,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  onAdd: (optionIds: string[], qty: number) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(() => defaultSelection(item));
  const [qty, setQty] = useState(1);

  const toggle = (group: OptionGroup, option: Option) => {
    setChosen((current) => {
      const inGroup = group.options.map((o) => o.id);
      const isOn = current.includes(option.id);

      if (isSingleChoice(group)) {
        // Picking a second answer replaces the first rather than stacking.
        const others = current.filter((id) => !inGroup.includes(id));
        return isOn && !isRequired(group) ? others : [...others, option.id];
      }

      if (isOn) return current.filter((id) => id !== option.id);

      const countInGroup = current.filter((id) => inGroup.includes(id)).length;
      if (countInGroup >= group.maxSelect) return current;
      return [...current, option.id];
    });
  };

  const valid = isSelectionValid(item, chosen);

  const total = useMemo(() => {
    const extra = item.optionGroups
      .flatMap((group) => group.options)
      .filter((option) => chosen.includes(option.id))
      .reduce((sum, option) => sum + option.priceDelta, 0);
    return (item.price + extra) * qty;
  }, [item, chosen, qty]);

  return (
    <div
      className="sheet"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="ticket" role="dialog" aria-label={item.nameEn}>
        <div className="opt__head">
          <p className="opt__th">{item.nameTh}</p>
          <p className="opt__en">
            {item.nameEn} · {formatBaht(item.price)}
          </p>
        </div>

        {item.optionGroups.map((group) => {
          const single = isSingleChoice(group);
          const countInGroup = group.options.filter((option) =>
            chosen.includes(option.id),
          ).length;

          return (
            <fieldset
              className="opt__group"
              key={group.id}
              style={{ border: 0, margin: 0, padding: 0 }}
            >
              <div className="opt__label">
                <legend className="opt__name" style={{ padding: 0 }}>
                  {group.nameTh}
                </legend>
                <span
                  className="opt__rule"
                  {...(isRequired(group) && { 'data-required': '' })}
                >
                  {groupRuleLabel(group)}
                  {isRequired(group) ? ' · required' : ''}
                </span>
              </div>

              {group.options.map((option) => {
                const checked = chosen.includes(option.id);
                const capped =
                  !single && !checked && countInGroup >= group.maxSelect;

                return (
                  <button
                    type="button"
                    key={option.id}
                    className="opt__choice"
                    role={single ? 'radio' : 'checkbox'}
                    aria-checked={checked}
                    disabled={!option.isAvailable || capped}
                    onClick={() => toggle(group, option)}
                  >
                    <span
                      className="opt__mark"
                      data-shape={single ? 'one' : 'many'}
                      aria-hidden="true"
                    >
                      {checked ? '✓' : ''}
                    </span>
                    <span className="opt__text">
                      {option.nameTh}
                      <span className="opt__sub">
                        {option.nameEn}
                        {!option.isAvailable ? ' · sold out' : ''}
                      </span>
                    </span>
                    <span className="opt__delta">
                      {formatDelta(option.priceDelta)}
                    </span>
                  </button>
                );
              })}
            </fieldset>
          );
        })}

        <div className="opt__actions">
        <div className="opt__qty">
          <div className="stepper">
            <button
              type="button"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              aria-label="One fewer"
            >
              −
            </button>
            <span className="stepper__qty">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((n) => Math.min(99, n + 1))}
              aria-label="One more"
            >
              +
            </button>
          </div>
          <span className="total__amount">{formatBaht(total)}</span>
        </div>

        <button
          className="btn btn--go"
          type="button"
          disabled={!valid}
          onClick={() => onAdd(chosen, qty)}
        >
          {valid ? `Add ${formatBaht(total)}` : 'Choose the required options'}
        </button>
        <button className="btn btn--quiet" type="button" onClick={onClose}>
          Back to the menu
        </button>
        </div>
      </div>
    </div>
  );
}
