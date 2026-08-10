import { useMemo, useState } from 'react';
import type React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addCategory,
  addMenuItem,
  addOptionGroup,
  ApiError,
  registerVendor,
} from '../api';
import { FloatingToast } from '../components/FloatingToast';
import { saveSession, type Session } from '../session';
import { theme } from '../theme';

type CategoryDraft = { id: string; name: string };
type OptionPreset = 'none' | 'spice' | 'addons';
type DishDraft = {
  id: string;
  categoryId: string | null;
  name: string;
  price: string;
  preset: OptionPreset;
};

const starterCategories: CategoryDraft[] = [
  { id: 'cat-main', name: 'Main dishes' },
  { id: 'cat-drinks', name: 'Drinks' },
];

const cleanSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);

const sameName = (name: string) => ({ nameTh: name.trim(), nameEn: name.trim() });

const slugWithSuffix = (base: string, suffix: string) =>
  `${base.slice(0, Math.max(3, 39 - suffix.length))}-${suffix}`;

export function RegisterScreen({
  onSignedIn,
  onBack,
}: {
  onSignedIn: (s: Session) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugSeed] = useState(() => Math.random().toString(36).slice(2, 8));
  const [pin, setPin] = useState('');
  const [promptpayId, setPromptpayId] = useState('');
  const [categories, setCategories] = useState<CategoryDraft[]>(starterCategories);
  const [categoryName, setCategoryName] = useState('');
  const [dishes, setDishes] = useState<DishDraft[]>([
    { id: 'dish-1', categoryId: 'cat-main', name: '', price: '', preset: 'none' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuNote, setMenuNote] = useState<string | null>(null);
  const slugBase = cleanSlug(slug || name);
  const generatedSlug = slugBase.length >= 3 ? slugBase : `stall-${slugSeed}`;

  const accountReady =
    name.trim().length > 0 &&
    generatedSlug.length >= 3 &&
    /^\d{4,8}$/.test(pin.trim());
  const stepReady =
    step === 0
      ? name.trim().length > 0 && generatedSlug.length >= 3
      : step === 1
        ? accountReady
        : true;

  const validDishes = useMemo(
    () =>
      dishes
        .map((dish) => ({
          ...dish,
          name: dish.name.trim(),
          priceBaht: Number(dish.price),
        }))
        .filter(
          (dish) =>
            dish.name.length > 0 &&
            dish.price.trim().length > 0 &&
            Number.isInteger(dish.priceBaht) &&
            dish.priceBaht >= 0,
        ),
    [dishes],
  );

  const addCategoryDraft = () => {
    const trimmed = categoryName.trim();
    if (!trimmed) return;
    setCategories((current) => [
      ...current,
      { id: `cat-${Date.now()}`, name: trimmed },
    ]);
    setCategoryName('');
  };

  const updateDish = (id: string, patch: Partial<DishDraft>) => {
    setDishes((current) =>
      current.map((dish) => (dish.id === id ? { ...dish, ...patch } : dish)),
    );
  };

  const addDishDraft = () => {
    setDishes((current) => [
      ...current,
      {
        id: `dish-${Date.now()}`,
        categoryId: categories[0]?.id ?? null,
        name: '',
        price: '',
        preset: 'none',
      },
    ]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMenuNote(null);

    try {
      const registrationBody = {
        name: name.trim(),
        slug: generatedSlug,
        pin: pin.trim(),
        ...(promptpayId.trim() ? { promptpayId: promptpayId.trim() } : {}),
      };
      let registered: Awaited<ReturnType<typeof registerVendor>>;
      try {
        registered = await registerVendor(registrationBody);
      } catch (caught) {
        const apiError = caught as ApiError;
        if (apiError.code !== 'slug_taken' && apiError.code !== 'slug_reserved') {
          throw caught;
        }
        registered = await registerVendor({
          ...registrationBody,
          slug: slugWithSuffix(generatedSlug, slugSeed),
        });
      }

      const session: Session = {
        token: registered.token,
        stall: registered.vendor,
      };

      try {
        const categoryIds = new Map<string, string>();
        for (const [index, category] of categories.entries()) {
          const saved = await addCategory(registered.token, {
            ...sameName(category.name),
            sortOrder: index,
          });
          categoryIds.set(category.id, saved.id);
        }

        for (const [index, dish] of validDishes.entries()) {
          const saved = await addMenuItem(registered.token, {
            categoryId: dish.categoryId ? categoryIds.get(dish.categoryId) ?? null : null,
            ...sameName(dish.name),
            price: dish.priceBaht,
            sortOrder: index,
          });

          if (dish.preset === 'spice') {
            await addOptionGroup(registered.token, saved.id, {
              nameTh: 'Spice level',
              nameEn: 'Spice level',
              minSelect: 1,
              maxSelect: 1,
              options: ['Mild', 'Medium', 'Hot'].map((level) => ({
                nameTh: level,
                nameEn: level,
              })),
            });
          }

          if (dish.preset === 'addons') {
            await addOptionGroup(registered.token, saved.id, {
              nameTh: 'Add-ons',
              nameEn: 'Add-ons',
              minSelect: 0,
              maxSelect: 3,
              options: [
                { nameTh: 'Extra egg', nameEn: 'Extra egg', priceDelta: 10 },
                { nameTh: 'Extra meat', nameEn: 'Extra meat', priceDelta: 20 },
                { nameTh: 'Extra noodles', nameEn: 'Extra noodles', priceDelta: 10 },
              ],
            });
          }
        }
      } catch {
        setMenuNote('Your stall is open. A few menu items may need adding again later.');
      }

      await saveSession(session);
      onSignedIn(session);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError.message ?? 'Could not create the stall.');
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={step === 0 ? onBack : () => setStep((current) => current - 1)}>
          <Text style={styles.back}>{step === 0 ? 'Sign in' : 'Back'}</Text>
        </Pressable>
        <Text style={styles.step}>{step + 1}/5</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.mark}>KHAIDEE</Text>

        {step === 0 && (
          <Panel
            title="Name the stall"
            body="This is what customers see after scanning the QR."
          >
            <Field label="Stall name" value={name} onChangeText={(value) => {
              setName(value);
              setSlug(cleanSlug(value));
            }} placeholder="Somchai Noodles" />
            <Text style={styles.slugPreview}>Stall link: {generatedSlug}</Text>
          </Panel>
        )}

        {step === 1 && (
          <Panel title="Set the counter PIN" body="Four to eight digits, easy for staff to type.">
            <Field
              label="PIN"
              value={pin}
              onChangeText={setPin}
              placeholder="1234"
              inputMode="numeric"
              secureTextEntry
              maxLength={8}
            />
          </Panel>
        )}

        {step === 2 && (
          <Panel title="How can people pay?" body="PromptPay is optional. Cash-only stalls can skip it.">
            <Field
              label="PromptPay ID"
              value={promptpayId}
              onChangeText={setPromptpayId}
              placeholder="Phone number or national ID"
              inputMode="numeric"
            />
          </Panel>
        )}

        {step === 3 && (
          <Panel title="Menu sections" body="A couple of headings keeps the QR menu easy to scan.">
            <View style={styles.pills}>
              {categories.map((category) => (
                <Pressable
                  key={category.id}
                  style={styles.pill}
                  onPress={() =>
                    setCategories((current) =>
                      current.length === 1
                        ? current
                        : current.filter((item) => item.id !== category.id),
                    )
                  }
                >
                  <Text style={styles.pillText}>{category.name}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={categoryName}
                onChangeText={setCategoryName}
                placeholder="Desserts"
                placeholderTextColor={theme.muted}
              />
              <Pressable style={styles.smallButton} onPress={addCategoryDraft}>
                <Text style={styles.smallButtonText}>Add</Text>
              </Pressable>
            </View>
          </Panel>
        )}

        {step === 4 && (
          <Panel title="First dishes" body="Add what is ready today. Photos and richer edits can come later.">
            {dishes.map((dish, index) => (
              <View key={dish.id} style={styles.dish}>
                <Text style={styles.dishTitle}>Dish {index + 1}</Text>
                <Field
                  label="Name"
                  value={dish.name}
                  onChangeText={(value) => updateDish(dish.id, { name: value })}
                  placeholder="Pad Thai"
                />
                <Field
                  label="Price"
                  value={dish.price}
                  onChangeText={(value) =>
                    updateDish(dish.id, { price: value.replace(/[^0-9]/g, '') })
                  }
                  placeholder="60"
                  inputMode="numeric"
                />
                <Text style={styles.label}>Section</Text>
                <View style={styles.pills}>
                  {categories.map((category) => (
                    <Pressable
                      key={category.id}
                      style={[
                        styles.pill,
                        dish.categoryId === category.id && styles.pillActive,
                      ]}
                      onPress={() => updateDish(dish.id, { categoryId: category.id })}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          dish.categoryId === category.id && styles.pillActiveText,
                        ]}
                      >
                        {category.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>Options</Text>
                <View style={styles.segment}>
                  {[
                    ['none', 'None'],
                    ['spice', 'Spice'],
                    ['addons', 'Add-ons'],
                  ].map(([value, label]) => (
                    <Pressable
                      key={value}
                      style={[
                        styles.segmentItem,
                        dish.preset === value && styles.segmentItemActive,
                      ]}
                      onPress={() =>
                        updateDish(dish.id, { preset: value as OptionPreset })
                      }
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          dish.preset === value && styles.segmentTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            <Pressable style={styles.addDish} onPress={addDishDraft}>
              <Text style={styles.addDishText}>Add another dish</Text>
            </Pressable>
          </Panel>
        )}

        <Pressable
          style={[
            styles.button,
            !stepReady && styles.buttonOff,
          ]}
          disabled={busy || !stepReady}
          onPress={() => {
            if (step < 4) setStep((current) => current + 1);
            else void submit();
          }}
        >
          {busy ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.buttonText}>{step === 4 ? 'Open the stall' : 'Next'}</Text>
          )}
        </Pressable>

        {step >= 2 && step < 4 && (
          <Pressable onPress={() => setStep((current) => current + 1)}>
            <Text style={styles.skip}>Skip this</Text>
          </Pressable>
        )}
        {step === 4 && validDishes.length === 0 && (
          <Pressable onPress={() => void submit()} disabled={busy}>
            <Text style={styles.skip}>Open without menu</Text>
          </Pressable>
        )}
      </ScrollView>
      <FloatingToast
        message={error ?? menuNote}
        tone={error ? 'error' : 'success'}
        onDone={() => {
          setError(null);
          setMenuNote(null);
        }}
      />
    </View>
  );
}

function Panel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
      <View style={{ marginTop: 20 }}>{children}</View>
    </View>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        style={[styles.input, props.style]}
        placeholderTextColor={theme.muted}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
  },
  back: { color: theme.muted, fontWeight: '700', fontSize: 14 },
  step: { color: theme.ink, fontWeight: '800', fontSize: 13 },
  body: { padding: 24, paddingBottom: 42, maxWidth: 540, width: '100%', alignSelf: 'center' },
  mark: {
    fontSize: 12,
    letterSpacing: 4,
    color: theme.muted,
    fontWeight: '700',
    marginBottom: 10,
  },
  title: { fontSize: 31, lineHeight: 36, fontWeight: '800', color: theme.ink },
  bodyText: { marginTop: 10, fontSize: 16, color: theme.muted, lineHeight: 23 },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: theme.muted,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 15,
    fontSize: 18,
    color: theme.ink,
    backgroundColor: theme.white,
    marginBottom: 18,
  },
  slugPreview: {
    marginTop: -8,
    color: theme.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  pill: {
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 2,
  },
  pillActive: { borderColor: theme.stool, backgroundColor: theme.stool },
  pillText: { color: theme.ink, fontWeight: '700', fontSize: 14 },
  pillActiveText: { color: theme.white },
  smallButton: {
    backgroundColor: theme.ink,
    paddingHorizontal: 18,
    borderRadius: 2,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: { color: theme.white, fontWeight: '800', fontSize: 15 },
  dish: {
    borderTopWidth: 1,
    borderTopColor: theme.rule,
    paddingTop: 18,
    marginTop: 18,
  },
  dishTitle: { fontSize: 16, fontWeight: '800', color: theme.ink, marginBottom: 14 },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  segmentItem: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.white,
  },
  segmentItemActive: { backgroundColor: theme.ink },
  segmentText: { color: theme.ink, fontWeight: '700', fontSize: 14 },
  segmentTextActive: { color: theme.white },
  addDish: {
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 2,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  addDishText: { color: theme.ink, fontSize: 15, fontWeight: '800' },
  button: {
    backgroundColor: theme.stool,
    paddingVertical: 18,
    borderRadius: 2,
    alignItems: 'center',
    marginTop: 28,
    minHeight: 58,
    justifyContent: 'center',
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: theme.white, fontSize: 17, fontWeight: '800' },
  skip: { color: theme.muted, textAlign: 'center', marginTop: 18, fontWeight: '700' },
  error: {
    backgroundColor: theme.chilli,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginTop: 18,
  },
  note: {
    backgroundColor: theme.yolk,
    color: theme.ink,
    padding: 12,
    fontSize: 15,
    marginTop: 18,
    fontWeight: '700',
  },
});
