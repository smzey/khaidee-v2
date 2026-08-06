import { type OrderDto, formatBaht, lineTotal, statusLabel } from '@khaidee/domain';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError,
  type Payment,
  cancelOrder,
  getOrder,
  getPayment,
  streamUrl,
} from '../api.js';
import { Mark } from '../components/Mark.js';
import {
  clientId,
  forgetOrder,
  lastStall,
  rememberedClientId,
} from '../clientId.js';

export function OrderScreen() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // First paint from a plain fetch, so the ticket is on screen even if the
  // stream is slow to open.
  useEffect(() => {
    let live = true;
    getOrder(id)
      .then((data) => live && setOrder(data))
      .catch((caught: ApiError) => live && setError(caught.message));
    return () => {
      live = false;
    };
  }, [id]);

  /**
   * The stall pushes each step down this stream. EventSource reconnects on
   * its own and replays what was missed, which is what makes this survive a
   * walk behind a concrete pillar.
   */
  useEffect(() => {
    const source = new EventSource(streamUrl(id));
    const onMessage = (event: MessageEvent) => {
      try {
        setOrder(JSON.parse(event.data) as OrderDto);
      } catch {
        /* a malformed frame is not worth breaking the screen over */
      }
    };
    source.addEventListener('order.updated', onMessage);
    source.addEventListener('order.placed', onMessage);
    return () => source.close();
  }, [id]);

  useEffect(() => {
    if (!order) return;
    getPayment(order.id)
      .then(setPayment)
      .catch(() => setPayment(null));
  }, [order?.id, order?.total]);

  if (error) {
    return (
      <div className="plain">
        <h1 className="plain__title">Order not found</h1>
        <p className="plain__body">{error}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="plain">
        <p className="plain__body">Finding your order…</p>
      </div>
    );
  }

  const settled = order.status === 'completed' || order.status === 'cancelled';
  const canCancel = order.status === 'placed';
  const orderAgainSlug = lastStall();

  const cancel = async () => {
    setCancelling(true);
    try {
      setOrder(await cancelOrder(order.id, rememberedClientId() ?? clientId()));
      forgetOrder();
    } catch (caught) {
      setError((caught as ApiError).message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="stub" data-status={order.status}>
      <p className="stub__stall">{order.vendorName}</p>
      <p className="stub__label">Listen for</p>
      <p className="stub__number">{order.queueNo}</p>

      <p className="stub__state">
        <span className="stub__dot" />
        {statusLabel(order.status)}
      </p>

      <div className="stub__perf" />

      {order.lines.map((line, index) => (
        <div className="line" key={`${line.menuItemId}-${index}`}>
          <span className="line__qty">{line.qty}×</span>
          <span>{line.nameSnapshot}</span>
          <span className="line__amount">{formatBaht(lineTotal(line))}</span>
          {line.options.length > 0 && (
            <span className="line__options">
              {line.options.map((option) => option.nameSnapshot).join(' · ')}
            </span>
          )}
        </div>
      ))}

      <div className="total">
        <span className="total__label">
          {order.status === 'completed' ? 'Paid' : 'To pay'}
        </span>
        <span className="total__amount">{formatBaht(order.total)}</span>
      </div>

      {!settled && (
        <div className="pay">
          {payment?.promptpayQrDataUrl ? (
            <>
              <p className="pay__title">PromptPay</p>
              <img
                className="pay__qr"
                src={payment.promptpayQrDataUrl}
                alt={`PromptPay code for ${formatBaht(order.total)}`}
              />
              <p className="pay__how">
                Scan with your banking app. The amount is already set to{' '}
                {formatBaht(order.total)}.
              </p>
              <p className="pay__cash">
                Check the recipient name in the bank app before paying.
              </p>
            </>
          ) : (
            <p className="pay__how">
              Pay {formatBaht(order.total)} at the stall when you collect.
            </p>
          )}
        </div>
      )}

      <div className="stub__spacer" />

      {canCancel && (
        <button
          className="btn btn--danger"
          type="button"
          onClick={cancel}
          disabled={cancelling}
        >
          {cancelling ? 'Cancelling…' : 'Cancel this order'}
        </button>
      )}

      {order.status === 'accepted' && (
        <p className="pay__cash">
          The stall has started cooking, so this can’t be cancelled now.
        </p>
      )}

      {settled && (
        <Link className="btn btn--quiet" to={orderAgainSlug ? `/s/${orderAgainSlug}` : '/'}>
          Order again
        </Link>
      )}

      <Mark />
    </div>
  );
}
