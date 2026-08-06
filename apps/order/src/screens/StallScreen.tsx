import {
  type Cart,
  type MenuItem,
  addEntry,
  cartCount,
  cartToLines,
  cartTotal,
  emptyCart,
  formatBaht,
  lineTotal,
  qtyOfItem,
  removeEntry,
} from '@khaidee/domain';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mark } from '../components/Mark.js';
import { OptionSheet } from '../components/OptionSheet.js';
import { ApiError, type Storefront, absoluteUrl, getStorefront, placeOrder } from '../api.js';
import { clientId, rememberOrder, rememberStall } from '../clientId.js';

const ALL = 'all';

export function StallScreen() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();

  const [stall, setStall] = useState<Storefront | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [category, setCategory] = useState<string>(ALL);
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    let live = true;
    getStorefront(slug)
      .then((data) => {
        if (!live) return;
        rememberStall(data.vendor.slug);
        setStall(data);
      })
      .catch((error: ApiError) => live && setLoadError(error.message));
    return () => {
      live = false;
    };
  }, [slug]);

  const menu = stall?.menu ?? [];
  const total = useMemo(() => cartTotal(cart, menu), [cart, menu]);
  const count = cartCount(cart);

  if (loadError) {
    return (
      <div className="plain">
        <h1 className="plain__title">
          {loadError.toLowerCase().includes('connection') ? 'Cannot reach the stall' : 'No stall here'}
        </h1>
        <p className="plain__body">{loadError}</p>
      </div>
    );
  }

  if (!stall) {
    return (
      <div className="plain">
        <p className="plain__body">Loading the menu…</p>
      </div>
    );
  }

  const shown =
    category === ALL
      ? menu
      : menu.filter((item) => item.categoryId === category);

  /**
   * Dishes grouped under their category heading. Uncategorised ones fall to
   * the end under "More" rather than disappearing.
   */
  const sections =
    category === ALL
      ? [
          ...stall.categories.map((c) => ({
            id: c.id,
            title: `${c.nameTh} ${c.nameEn}`,
            items: menu.filter((item) => item.categoryId === c.id),
          })),
          {
            id: 'none',
            title: 'More',
            items: menu.filter((item) => item.categoryId === null),
          },
        ].filter((section) => section.items.length > 0)
      : [{ id: category, title: '', items: shown }];

  const add = (item: MenuItem, optionIds: string[], qty: number) => {
    setCart((current) => addEntry(current, item.id, optionIds, qty));
    setChoosing(null);
  };

  const tap = (item: MenuItem) => {
    if (!item.isAvailable || !stall.vendor.isOpen) return;
    // A dish that asks nothing goes straight in; no sheet to dismiss.
    if (item.optionGroups.length === 0) add(item, [], 1);
    else setChoosing(item);
  };

  return (
    <>
      <div className="stall">
        <header className="stall__head">
          <p className="stall__status" {...(!stall.vendor.isOpen && { 'data-shut': '' })}>
            {stall.vendor.isOpen ? 'Open now' : 'Closed'}
          </p>
          <h1 className="stall__name">{stall.vendor.name}</h1>
          {!stall.vendor.isOpen && (
            <p className="stall__shut">
              The stall isn’t taking orders right now. Come back when it opens,
              or order at the counter.
            </p>
          )}
        </header>

        {stall.categories.length > 0 && (
          <nav className="chips" aria-label="Categories">
            <button
              type="button"
              className="chip"
              aria-pressed={category === ALL}
              onClick={() => setCategory(ALL)}
            >
              All
            </button>
            {stall.categories.map((c) => (
              <button
                type="button"
                key={c.id}
                className="chip"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.nameTh}
              </button>
            ))}
          </nav>
        )}

        {sections.map((section) => (
          <section key={section.id}>
            {section.title && <h2 className="group__title">{section.title}</h2>}
            <div className="grid">
              {section.items.map((item) => (
                <Tile
                  key={item.id}
                  item={item}
                  qty={qtyOfItem(cart, item.id)}
                  onTap={() => tap(item)}
                />
              ))}
            </div>
          </section>
        ))}

        <Mark />
      </div>

      {count > 0 && stall.vendor.isOpen && (
        <div className="bar">
          <div>
            <p className="bar__count">
              {count} {count === 1 ? 'item' : 'items'}
            </p>
            <p className="bar__total">{formatBaht(total)}</p>
          </div>
          <button className="bar__go" type="button" onClick={() => setReviewing(true)}>
            Review order
          </button>
        </div>
      )}

      {choosing && (
        <OptionSheet
          item={choosing}
          onAdd={(optionIds, qty) => add(choosing, optionIds, qty)}
          onClose={() => setChoosing(null)}
        />
      )}

      {reviewing && (
        <ConfirmTicket
          stall={stall}
          cart={cart}
          onClose={() => setReviewing(false)}
          onRemove={(key) =>
            setCart((current) => {
              const next = removeEntry(current, key);
              if (next.length === 0) setReviewing(false);
              return next;
            })
          }
          onDrop={(itemIds) =>
            setCart((current) =>
              current.filter((entry) => !itemIds.includes(entry.itemId)),
            )
          }
          onPlaced={(orderId) => navigate(`/o/${orderId}`)}
        />
      )}
    </>
  );
}

/** A stable tint per dish, so a stall's grid looks arranged rather than random. */
function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 34% 88%)`;
}

function Tile({
  item,
  qty,
  onTap,
}: {
  item: MenuItem;
  qty: number;
  onTap: () => void;
}) {
  const asks = item.optionGroups.length > 0;

  return (
    <button
      type="button"
      className="tile"
      onClick={onTap}
      disabled={!item.isAvailable}
      {...(!item.isAvailable && { 'data-out': '' })}
      aria-label={`${item.nameEn}, ${formatBaht(item.price)}`}
    >
      <span className="tile__art">
        {item.imageUrl ? (
          <img src={absoluteUrl(item.imageUrl)} alt="" loading="lazy" />
        ) : (
          <span
            className="tile__placeholder"
            style={{ ['--tint' as string]: tintFor(item.nameEn) }}
            aria-hidden="true"
          />
        )}
      </span>

      <span className="tile__body">
        <span className="tile__th">{item.nameTh}</span>
        <span className="tile__en">{item.nameEn}</span>
        <span className="tile__foot">
          <span className="tile__price">{formatBaht(item.price)}</span>
          {!item.isAvailable ? (
            <span className="tile__out">Sold out</span>
          ) : asks ? (
            <span className="tile__more">Choose</span>
          ) : (
            <span className="add" aria-hidden="true">
              +
            </span>
          )}
        </span>
      </span>

      {qty > 0 && <span className="tile__badge">{qty}</span>}
    </button>
  );
}

function ConfirmTicket({
  stall,
  cart,
  onClose,
  onPlaced,
  onRemove,
  onDrop,
}: {
  stall: Storefront;
  cart: Cart;
  onClose: () => void;
  onPlaced: (orderId: string) => void;
  onRemove: (key: string) => void;
  onDrop: (itemIds: string[]) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderClientId] = useState(() => clientId());

  const total = cartTotal(cart, stall.menu);
  const menuOrder = new Map(stall.menu.map((item, index) => [item.id, index]));
  const pricedEntries = cart
    .flatMap((entry) => {
      const [line] = cartToLines([entry], stall.menu);
      return line ? [{ entry, line }] : [];
    })
    .sort(
      (a, b) =>
        (menuOrder.get(a.entry.itemId) ?? 0) - (menuOrder.get(b.entry.itemId) ?? 0) ||
        a.entry.key.localeCompare(b.entry.key),
    );

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const order = await placeOrder(
        stall.vendor.slug,
        cart.map((entry) => ({
          itemId: entry.itemId,
          qty: entry.qty,
          optionIds: entry.optionIds,
        })),
        orderClientId,
      );
      rememberOrder(order.id, orderClientId);
      onPlaced(order.id);
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.code === 'items_unavailable' && apiError.details?.items) {
        onDrop(apiError.details.items.map((item) => item.id));
      }
      setError(apiError.message);
      setSending(false);
    }
  };

  return (
    <div
      className="sheet"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="ticket" role="dialog" aria-label="Your order">
        <p className="ticket__stall">{stall.vendor.name}</p>
        <div className="perf" />

        {pricedEntries.map(({ entry, line }) => (
          <div className="ticket-line" key={entry.key}>
            <span className="ticket-line__qty">{line.qty}×</span>
            <span className="ticket-line__copy">
              <span className="ticket-line__name">{line.nameSnapshot}</span>
              {line.options.length > 0 && (
                <span className="ticket-line__options">
                  {line.options.map((option) => option.nameSnapshot).join(' · ')}
                </span>
              )}
            </span>
            <span className="ticket-line__side">
              <span className="ticket-line__amount">{formatBaht(lineTotal(line))}</span>
              <button
                className="ticket-line__remove"
                type="button"
                onClick={() => onRemove(entry.key)}
                disabled={sending}
                aria-label={`Remove one ${line.nameSnapshot}`}
              >
                -
              </button>
            </span>
          </div>
        ))}

        <div className="perf" />
        <div className="total">
          <span className="total__label">Total</span>
          <span className="total__amount">{formatBaht(total)}</span>
        </div>

        <p className="note">
          Pay at the stall when you collect — cash or PromptPay. You’ll get a
          number to listen for.
        </p>

        {error && <p className="error">{error}</p>}

        <button className="btn btn--go" type="button" onClick={send} disabled={sending}>
          {sending ? 'Sending…' : 'Send to the stall'}
        </button>
        <button className="btn btn--quiet" type="button" onClick={onClose}>
          Keep looking
        </button>
      </div>
    </div>
  );
}
