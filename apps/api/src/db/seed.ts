import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { categories, menuItems, optionGroups, options, vendors } from './schema.js';
import { hashPin } from '../lib/auth.js';

/**
 * One stall with a real menu, real categories and real options. Deliberately
 * no generated order history — this build's job is the ordering loop, and fake
 * orders only get in the way of watching real ones arrive.
 */
const SPICE = {
  nameTh: 'ระดับความเผ็ด',
  nameEn: 'Spice level',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { nameTh: 'ไม่เผ็ด', nameEn: 'Not spicy', priceDelta: 0 },
    { nameTh: 'เผ็ดน้อย', nameEn: 'Mild', priceDelta: 0 },
    { nameTh: 'เผ็ดมาก', nameEn: 'Thai hot', priceDelta: 0 },
  ],
};

const ADDONS = {
  nameTh: 'เพิ่มเติม',
  nameEn: 'Add-ons',
  minSelect: 0,
  maxSelect: 3,
  options: [
    { nameTh: 'ไข่ดาว', nameEn: 'Fried egg', priceDelta: 10 },
    { nameTh: 'เพิ่มเส้น', nameEn: 'Extra noodles', priceDelta: 15 },
    { nameTh: 'กุ้ง', nameEn: 'Prawns', priceDelta: 30 },
  ],
};

const SWEETNESS = {
  nameTh: 'ความหวาน',
  nameEn: 'Sweetness',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { nameTh: 'หวานน้อย', nameEn: 'Less sweet', priceDelta: 0 },
    { nameTh: 'หวานปกติ', nameEn: 'Normal', priceDelta: 0 },
    { nameTh: 'หวานมาก', nameEn: 'Extra sweet', priceDelta: 0 },
  ],
};

const CATEGORIES = [
  { nameTh: 'เส้น', nameEn: 'Noodles' },
  { nameTh: 'ข้าว', nameEn: 'Rice dishes' },
  { nameTh: 'ส้มตำ', nameEn: 'Som Tam' },
  { nameTh: 'เครื่องดื่ม', nameEn: 'Drinks' },
];

const MENU = [
  { nameTh: 'ผัดไทย', nameEn: 'Pad Thai', price: 60, category: 'Noodles', groups: [SPICE, ADDONS] },
  { nameTh: 'ผัดซีอิ๊ว', nameEn: 'Pad See Ew', price: 60, category: 'Noodles', groups: [SPICE, ADDONS] },
  { nameTh: 'ก๋วยเตี๋ยวต้มยำ', nameEn: 'Tom Yum Noodles', price: 65, category: 'Noodles', groups: [SPICE, ADDONS] },
  { nameTh: 'ผัดกะเพรา', nameEn: 'Pad Kaphrao', price: 55, category: 'Rice dishes', groups: [SPICE, ADDONS] },
  { nameTh: 'ข้าวมันไก่', nameEn: 'Khao Man Kai', price: 50, category: 'Rice dishes', groups: [] },
  { nameTh: 'ข้าวผัด', nameEn: 'Fried Rice', price: 50, category: 'Rice dishes', groups: [SPICE, ADDONS] },
  { nameTh: 'ส้มตำไทย', nameEn: 'Som Tam Thai', price: 45, category: 'Som Tam', groups: [SPICE] },
  { nameTh: 'ส้มตำปูปลาร้า', nameEn: 'Som Tam Poo Pla Ra', price: 55, category: 'Som Tam', groups: [SPICE] },
  { nameTh: 'ชาไทย', nameEn: 'Thai Tea', price: 25, category: 'Drinks', groups: [SWEETNESS] },
  { nameTh: 'ชาเขียว', nameEn: 'Green Tea', price: 25, category: 'Drinks', groups: [SWEETNESS] },
  { nameTh: 'น้ำเปล่า', nameEn: 'Water', price: 10, category: 'Drinks', groups: [] },
];

async function seed() {
  const { db, sql } = createDb();

  const [existing] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.slug, 'somchai'))
    .limit(1);

  if (existing) {
    console.log('Stall "somchai" already seeded — nothing to do.');
    console.log('Drop it first if you want a fresh menu:');
    console.log("  psql -d khaidee_dev -c \"delete from vendors where slug='somchai'\"");
    await sql.end();
    return;
  }

  const [vendor] = await db
    .insert(vendors)
    .values({
      slug: 'somchai',
      name: "Somchai's Noodles",
      pinHash: hashPin('1234'),
      // Not a real account — a well-formed number so the collect screen has
      // a scannable QR during development.
      promptpayId: '0812345678',
    })
    .returning();

  if (!vendor) throw new Error('Failed to insert vendor');

  const categoryRows = await db
    .insert(categories)
    .values(
      CATEGORIES.map((category, index) => ({
        vendorId: vendor.id,
        ...category,
        sortOrder: index,
      })),
    )
    .returning();

  const categoryId = new Map(categoryRows.map((row) => [row.nameEn, row.id]));

  for (const [index, dish] of MENU.entries()) {
    const [item] = await db
      .insert(menuItems)
      .values({
        vendorId: vendor.id,
        categoryId: categoryId.get(dish.category) ?? null,
        nameTh: dish.nameTh,
        nameEn: dish.nameEn,
        price: dish.price,
        sortOrder: index,
      })
      .returning();

    if (!item) continue;

    for (const [groupIndex, group] of dish.groups.entries()) {
      const [groupRow] = await db
        .insert(optionGroups)
        .values({
          menuItemId: item.id,
          nameTh: group.nameTh,
          nameEn: group.nameEn,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          sortOrder: groupIndex,
        })
        .returning();

      if (!groupRow) continue;

      await db.insert(options).values(
        group.options.map((option, optionIndex) => ({
          groupId: groupRow.id,
          nameTh: option.nameTh,
          nameEn: option.nameEn,
          priceDelta: option.priceDelta,
          sortOrder: optionIndex,
        })),
      );
    }
  }

  console.log(`Seeded "${vendor.name}"`);
  console.log(`  ${CATEGORIES.length} categories, ${MENU.length} dishes`);
  console.log(`  customer:   /s/${vendor.slug}`);
  console.log(`  vendor PIN: 1234`);
  await sql.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
