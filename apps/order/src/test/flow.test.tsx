import type { MenuItem, OptionGroup, OrderDto } from '@khaidee/domain';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderScreen } from '../screens/OrderScreen.js';
import { StallScreen } from '../screens/StallScreen.js';
import { rememberOrder, rememberStall } from '../clientId.js';
import { FakeEventSource } from './setup.js';

const spice: OptionGroup = {
  id: 'g1',
  menuItemId: 'a',
  nameTh: 'ระดับความเผ็ด',
  nameEn: 'Spice level',
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 0,
  options: [
    { id: 'mild', groupId: 'g1', nameTh: 'เผ็ดน้อย', nameEn: 'Mild', priceDelta: 0, isAvailable: true, sortOrder: 0 },
    { id: 'hot', groupId: 'g1', nameTh: 'เผ็ดมาก', nameEn: 'Thai hot', priceDelta: 0, isAvailable: true, sortOrder: 1 },
  ],
};

const addons: OptionGroup = {
  id: 'g2',
  menuItemId: 'a',
  nameTh: 'เพิ่มเติม',
  nameEn: 'Add-ons',
  minSelect: 0,
  maxSelect: 2,
  sortOrder: 1,
  options: [
    { id: 'egg', groupId: 'g2', nameTh: 'ไข่ดาว', nameEn: 'Fried egg', priceDelta: 10, isAvailable: true, sortOrder: 0 },
    { id: 'prawns', groupId: 'g2', nameTh: 'กุ้ง', nameEn: 'Prawns', priceDelta: 30, isAvailable: true, sortOrder: 1 },
    { id: 'crab', groupId: 'g2', nameTh: 'ปู', nameEn: 'Crab', priceDelta: 40, isAvailable: false, sortOrder: 2 },
  ],
};

const item = (over: Partial<MenuItem> & { id: string }): MenuItem => ({
  vendorId: 'v1',
  categoryId: 'c1',
  nameTh: 'ผัดไทย',
  nameEn: 'Pad Thai',
  price: 60,
  imageUrl: null,
  isAvailable: true,
  sortOrder: 0,
  optionGroups: [],
  ...over,
});

const MENU: MenuItem[] = [
  item({ id: 'a', optionGroups: [spice, addons] }),
  item({
    id: 'b',
    categoryId: 'c2',
    nameTh: 'ชาไทย',
    nameEn: 'Thai Tea',
    price: 25,
    sortOrder: 1,
  }),
  item({
    id: 'c',
    categoryId: 'c1',
    nameTh: 'ส้มตำ',
    nameEn: 'Som Tam',
    price: 45,
    sortOrder: 2,
    isAvailable: false,
  }),
  item({
    id: 'd',
    categoryId: 'c2',
    nameTh: 'น้ำเปล่า',
    nameEn: 'Water',
    price: 10,
    sortOrder: 3,
    imageUrl: '/uploads/water.webp',
  }),
];

const STOREFRONT = {
  vendor: { id: 'v1', slug: 'somchai', name: "Somchai's Noodles", isOpen: true },
  categories: [
    { id: 'c1', vendorId: 'v1', nameTh: 'อาหาร', nameEn: 'Food', sortOrder: 0 },
    { id: 'c2', vendorId: 'v1', nameTh: 'เครื่องดื่ม', nameEn: 'Drinks', sortOrder: 1 },
  ],
  menu: MENU,
};

const order = (over: Partial<OrderDto> = {}): OrderDto => ({
  id: 'o1',
  vendorId: 'v1',
  vendorName: "Somchai's Noodles",
  businessDate: '2026-08-06',
  queueNo: 14,
  status: 'placed',
  source: 'customer',
  total: 95,
  paymentMethod: null,
  lines: [
    {
      menuItemId: 'a',
      qty: 1,
      unitPrice: 60,
      nameSnapshot: 'Pad Thai',
      options: [
        { optionId: 'mild', nameSnapshot: 'Mild', priceDelta: 0 },
        { optionId: 'egg', nameSnapshot: 'Fried egg', priceDelta: 10 },
      ],
    },
    { menuItemId: 'b', qty: 1, unitPrice: 25, nameSnapshot: 'Thai Tea', options: [] },
  ],
  placedAt: '2026-08-06T04:00:00.000Z',
  acceptedAt: null,
  readyAt: null,
  completedAt: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // Explicit, because vitest runs without globals here, so testing-library's
  // automatic cleanup hook never registers and renders would pile up.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderStall = () =>
  render(
    <MemoryRouter initialEntries={['/s/somchai']}>
      <Routes>
        <Route path="/s/:slug" element={<StallScreen />} />
        <Route path="/o/:id" element={<div>ticket for order</div>} />
      </Routes>
    </MemoryRouter>,
  );

const openMenu = async () => {
  fetchMock.mockImplementation(() => json(STOREFRONT));
  const view = renderStall();
  await screen.findByText("Somchai's Noodles");
  return view;
};

describe('the dish grid', () => {
  it('shows every dish with both language names and its price', async () => {
    const { container } = await openMenu();
    const tile = container.querySelector('.tile') as HTMLElement;
    expect(within(tile).getByText('Pad Thai')).toBeDefined();
    expect(within(tile).getByText('฿60')).toBeDefined();
    // Named once. The placeholder carries an initial, not a second copy.
    expect(within(tile).getAllByText('ผัดไทย')).toHaveLength(1);
  });

  it('shows the dish photo when there is one', async () => {
    const { container } = await openMenu();
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toContain('/uploads/water.webp');
  });

  it('falls back to a named placeholder rather than an empty box', async () => {
    const { container } = await openMenu();
    const placeholders = container.querySelectorAll('.tile__placeholder');
    // Three of the four dishes have no picture.
    expect(placeholders).toHaveLength(3);
    // No text: the label below names the dish, the plate marks the photo slot.
    expect(placeholders[0]?.textContent).toBe('');
  });

  it('marks a dish that asks questions, rather than a plain add button', async () => {
    const { container } = await openMenu();
    const padThai = container.querySelector('.tile');
    expect(within(padThai as HTMLElement).getByText('Choose')).toBeDefined();
  });

  it('marks a sold-out dish and refuses to open it', async () => {
    const user = userEvent.setup();
    await openMenu();
    expect(screen.getByText('Sold out')).toBeDefined();

    await user.click(screen.getByLabelText('Som Tam, ฿45'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('category chips', () => {
  it('lists every category the vendor defined, plus All', async () => {
    await openMenu();
    const chips = screen.getAllByRole('button', { pressed: false });
    expect(screen.getByText('อาหาร')).toBeDefined();
    expect(screen.getByText('เครื่องดื่ม')).toBeDefined();
    expect(chips.length).toBeGreaterThan(0);
  });

  it('starts on All, showing everything', async () => {
    await openMenu();
    expect(screen.getByLabelText('Pad Thai, ฿60')).toBeDefined();
    expect(screen.getByLabelText('Thai Tea, ฿25')).toBeDefined();
  });

  it('filters the grid to one category', async () => {
    const user = userEvent.setup();
    await openMenu();

    await user.click(screen.getByText('เครื่องดื่ม'));

    expect(screen.queryByLabelText('Pad Thai, ฿60')).toBeNull();
    expect(screen.getByLabelText('Thai Tea, ฿25')).toBeDefined();
  });

  it('goes back to everything', async () => {
    const user = userEvent.setup();
    await openMenu();

    await user.click(screen.getByText('เครื่องดื่ม'));
    await user.click(screen.getByText('All'));

    expect(screen.getByLabelText('Pad Thai, ฿60')).toBeDefined();
  });
});

describe('choosing options', () => {
  const openPadThai = async () => {
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByLabelText('Pad Thai, ฿60'));
    return user;
  };

  it('opens a sheet for a dish that asks questions', async () => {
    await openPadThai();
    expect(screen.getByRole('dialog', { name: 'Pad Thai' })).toBeDefined();
    expect(screen.getByText('ระดับความเผ็ด')).toBeDefined();
  });

  it('adds a dish with no questions straight to the cart', async () => {
    const user = userEvent.setup();
    await openMenu();

    await user.click(screen.getByLabelText('Thai Tea, ฿25'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Review order')).toBeDefined();
  });

  it('says the rule for each group', async () => {
    await openPadThai();
    expect(screen.getByText(/Choose one · required/)).toBeDefined();
    expect(screen.getByText('Up to 2')).toBeDefined();
  });

  it('pre-answers the required group so one tap can still add the dish', async () => {
    await openPadThai();
    const mild = screen.getByRole('radio', { name: /Mild/ });
    expect(mild.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Add ฿60')).toBeDefined();
  });

  it('replaces the answer in a pick-one group rather than stacking', async () => {
    const user = await openPadThai();
    await user.click(screen.getByRole('radio', { name: /Thai hot/ }));

    expect(
      screen.getByRole('radio', { name: /Mild/ }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('radio', { name: /Thai hot/ }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('adds each add-on to the price', async () => {
    const user = await openPadThai();
    await user.click(screen.getByRole('checkbox', { name: /Fried egg/ }));
    expect(screen.getByText('Add ฿70')).toBeDefined();

    await user.click(screen.getByRole('checkbox', { name: /Prawns/ }));
    expect(screen.getByText('Add ฿100')).toBeDefined();
  });

  it('shows what each option costs', async () => {
    await openPadThai();
    expect(screen.getByText('+฿10')).toBeDefined();
    expect(screen.getByText('+฿30')).toBeDefined();
  });

  it('stops at the cap for a pick-many group', async () => {
    const user = await openPadThai();
    await user.click(screen.getByRole('checkbox', { name: /Fried egg/ }));
    await user.click(screen.getByRole('checkbox', { name: /Prawns/ }));

    // maxSelect is 2, so nothing further can be chosen.
    expect(screen.getByText('Add ฿100')).toBeDefined();
  });

  it('will not offer a sold-out option', async () => {
    await openPadThai();
    const crab = screen.getByRole('checkbox', { name: /Crab/ });
    expect(crab.hasAttribute('disabled')).toBe(true);
  });

  it('multiplies dish and options by the quantity', async () => {
    const user = await openPadThai();
    await user.click(screen.getByRole('checkbox', { name: /Fried egg/ }));
    await user.click(screen.getByLabelText('One more'));
    await user.click(screen.getByLabelText('One more'));

    expect(screen.getByText('Add ฿210')).toBeDefined();
  });

  it('puts the chosen dish in the cart at the right price', async () => {
    const user = await openPadThai();
    await user.click(screen.getByRole('checkbox', { name: /Prawns/ }));
    await user.click(screen.getByText('Add ฿90'));

    expect(screen.getByText('฿90')).toBeDefined();
    expect(screen.getByText('1 item')).toBeDefined();
  });

  it('counts the same dish twice when the options differ', async () => {
    const user = await openPadThai();
    await user.click(screen.getByText('Add ฿60'));
    await user.click(screen.getByLabelText('Pad Thai, ฿60'));
    await user.click(screen.getByRole('checkbox', { name: /Fried egg/ }));
    await user.click(screen.getByText('Add ฿70'));

    expect(screen.getByText('2 items')).toBeDefined();
    expect(screen.getByText('฿130')).toBeDefined();
  });
});

describe('confirming the order', () => {
  it('lists chosen options under their line', async () => {
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByLabelText('Pad Thai, ฿60'));
    await user.click(screen.getByRole('checkbox', { name: /Fried egg/ }));
    await user.click(screen.getByText('Add ฿70'));
    await user.click(screen.getByText('Review order'));

    const ticket = screen.getByRole('dialog', { name: 'Your order' });
    expect(within(ticket).getByText('Mild · Fried egg')).toBeDefined();
    expect(ticket.querySelector('.total__amount')?.textContent).toBe('฿70');
  });

  it('lets the customer remove a chosen item before sending', async () => {
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByLabelText('Thai Tea, ฿25'));
    await user.click(screen.getByLabelText('Thai Tea, ฿25'));
    await user.click(screen.getByText('Review order'));

    const ticket = screen.getByRole('dialog', { name: 'Your order' });
    expect(within(ticket).getByText('2×')).toBeDefined();
    expect(ticket.querySelector('.total__amount')?.textContent).toBe('฿50');

    await user.click(within(ticket).getByRole('button', { name: 'Remove one Thai Tea' }));

    expect(within(ticket).getByText('1×')).toBeDefined();
    expect(ticket.querySelector('.total__amount')?.textContent).toBe('฿25');
  });

  it('closes the review ticket when the last item is removed', async () => {
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByLabelText('Thai Tea, ฿25'));
    await user.click(screen.getByText('Review order'));

    await user.click(screen.getByRole('button', { name: 'Remove one Thai Tea' }));

    expect(screen.queryByRole('dialog', { name: 'Your order' })).toBeNull();
    expect(screen.queryByText('Review order')).toBeNull();
  });

  it('sends dish ids, quantities and option ids — never a price', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(order(), 201) : json(STOREFRONT),
    );
    renderStall();
    await screen.findByText("Somchai's Noodles");

    await user.click(screen.getByLabelText('Pad Thai, ฿60'));
    await user.click(screen.getByRole('checkbox', { name: /Fried egg/ }));
    await user.click(screen.getByText('Add ฿70'));
    await user.click(screen.getByText('Review order'));
    await user.click(screen.getByText('Send to the stall'));

    await waitFor(() => expect(screen.getByText('ticket for order')).toBeDefined());

    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse((post?.[1] as RequestInit).body as string);

    expect(body.lines).toEqual([
      { itemId: 'a', qty: 1, optionIds: ['egg', 'mild'] },
    ]);
    expect(JSON.stringify(body)).not.toContain('unitPrice');
    expect(JSON.stringify(body)).not.toContain('priceDelta');
    expect(typeof body.clientId).toBe('string');
  });

  it('names what sold out and drops it, keeping the rest of the cart', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json(
          {
            code: 'items_unavailable',
            message: 'Pad Thai just sold out',
            details: { items: [{ id: 'a', name: 'Pad Thai', reason: 'sold_out' }] },
          },
          409,
        );
      }
      return json(STOREFRONT);
    });
    renderStall();
    await screen.findByText("Somchai's Noodles");

    await user.click(screen.getByLabelText('Pad Thai, ฿60'));
    await user.click(screen.getByText('Add ฿60'));
    await user.click(screen.getByLabelText('Thai Tea, ฿25'));
    await user.click(screen.getByText('Review order'));
    await user.click(screen.getByText('Send to the stall'));

    expect(await screen.findByText('Pad Thai just sold out')).toBeDefined();

    const ticket = screen.getByRole('dialog', { name: 'Your order' });
    expect(within(ticket).queryByText('Pad Thai')).toBeNull();
    expect(within(ticket).getByText('Thai Tea')).toBeDefined();
  });
});

const renderOrder = () =>
  render(
    <MemoryRouter initialEntries={['/o/o1']}>
      <Routes>
        <Route path="/o/:id" element={<OrderScreen />} />
      </Routes>
    </MemoryRouter>,
  );

describe('the ticket stub', () => {
  const withOrder = (current: OrderDto) =>
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/payment')) {
        return json({ total: current.total, promptpayPayload: null });
      }
      return json(current);
    });

  it('makes the queue number the loudest thing on the screen', async () => {
    withOrder(order());
    const { container } = renderOrder();

    const number = await waitFor(() => {
      const node = container.querySelector('.stub__number');
      if (!node) throw new Error('no queue number');
      return node;
    });
    expect(number.textContent).toBe('14');
  });

  it('names the stall, so two tickets cannot be confused', async () => {
    withOrder(order());
    renderOrder();
    expect(await screen.findByText("Somchai's Noodles")).toBeDefined();
  });

  it('shows the options each line was ordered with', async () => {
    withOrder(order());
    renderOrder();
    expect(await screen.findByText('Mild · Fried egg')).toBeDefined();
  });

  it('prices a line including its options', async () => {
    withOrder(order());
    const { container } = renderOrder();
    await screen.findByText('Pad Thai');
    const amounts = [...container.querySelectorAll('.line__amount')].map(
      (node) => node.textContent,
    );
    expect(amounts).toEqual(['฿70', '฿25']);
  });

  it('shows a PromptPay QR when the stall has PromptPay', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('/payment')
        ? json({
            total: 95,
            promptpayPayload: 'promptpay-payload',
            promptpayQrDataUrl: 'data:image/png;base64,abc',
          })
        : json(order()),
    );
    renderOrder();

    expect(await screen.findByText('PromptPay')).toBeDefined();
    const qr = screen.getByAltText('PromptPay code for ฿95') as HTMLImageElement;
    expect(qr.src).toContain('data:image/png;base64,abc');
  });

  it('follows the stall down the stream without a reload', async () => {
    withOrder(order());
    renderOrder();
    await screen.findByText('Sent to the stall');

    FakeEventSource.last?.push('order.updated', order({ status: 'ready' }));

    expect(await screen.findByText('Ready — come and collect')).toBeDefined();
  });

  it('flips the whole ticket when the order is ready', async () => {
    withOrder(order());
    const { container } = renderOrder();
    await screen.findByText('Sent to the stall');

    FakeEventSource.last?.push('order.updated', order({ status: 'ready' }));

    await waitFor(() =>
      expect(container.querySelector('.stub')?.getAttribute('data-status')).toBe(
        'ready',
      ),
    );
  });

  it('offers cancel while placed', async () => {
    withOrder(order());
    renderOrder();
    expect(await screen.findByText('Cancel this order')).toBeDefined();
  });

  it('cancels with the id from the active order, then clears the ticket', async () => {
    const user = userEvent.setup();
    rememberOrder('o1', 'order-key-1');
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/payment')) {
        return json({ total: 95, promptpayPayload: null });
      }
      if (init?.method === 'POST') {
        return json(order({ status: 'cancelled' }));
      }
      return json(order());
    });
    renderOrder();

    await user.click(await screen.findByText('Cancel this order'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(((post?.[1] as RequestInit).body as string))).toEqual({
        clientId: 'order-key-1',
      });
    });
    expect(localStorage.getItem('khaidee.order')).toBeNull();
    expect(localStorage.getItem('khaidee.orderClientId')).toBeNull();
  });

  it('withdraws cancel once the stall is cooking, and says why', async () => {
    withOrder(order({ status: 'accepted' }));
    renderOrder();
    await screen.findByText('Cooking');

    expect(screen.queryByText('Cancel this order')).toBeNull();
    expect(screen.getByText(/can’t be cancelled now/)).toBeDefined();
  });

  it('sends a finished ticket back to the last scanned stall', async () => {
    rememberStall('somchai');
    withOrder(order({ status: 'cancelled' }));
    renderOrder();

    const link = await screen.findByRole('link', { name: 'Order again' });
    expect(link.getAttribute('href')).toBe('/s/somchai');
  });

  it('closes the stream when the screen goes away', async () => {
    withOrder(order());
    const { unmount } = renderOrder();
    await screen.findByText('Sent to the stall');

    unmount();
    expect(FakeEventSource.last?.closed).toBe(true);
  });
});

describe('the KhaiDee mark', () => {
  it('sits under the menu without competing with the stall name', async () => {
    const { container } = await openMenu();
    const mark = container.querySelector('.mark');
    expect(mark?.textContent).toBe('KhaiDee');
  });

  it('is on the ticket too', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('/payment')
        ? json({ total: 95, promptpayPayload: null })
        : json(order()),
    );
    const { container } = renderOrder();
    await screen.findByText('Sent to the stall');
    expect(container.querySelector('.mark')?.textContent).toBe('KhaiDee');
  });
});
