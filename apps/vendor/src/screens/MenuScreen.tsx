import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  type Category,
  type MenuIngredient,
  type MenuItem,
  formatBaht,
} from '@khaidee/domain';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  API_URL,
  addCategory,
  addMenuItem,
  deleteCategory,
  deleteMenuItem,
  deleteMenuItemImage,
  fetchCategories,
  fetchMenu,
  setMenuItemAvailability,
  updateCategory,
  updateMenuItem,
  uploadMenuItemImage,
} from '../api';
import { FloatingToast } from '../components/FloatingToast';
import type { Session } from '../session';
import { theme } from '../theme';

const sameName = (name: string) => ({ nameTh: name.trim(), nameEn: name.trim() });
const imageUrlFor = (value: string) => {
  const url = new URL(value.startsWith('http') ? value : `${API_URL}${value}`);
  if (url.hostname.endsWith('ngrok-free.app')) {
    url.searchParams.set('ngrok-skip-browser-warning', 'true');
  }
  return url.toString();
};
type IngredientDraft = { key: string; name: string; qty: string; unit: string };

const emptyIngredient = (): IngredientDraft => ({
  key: `${Date.now()}-${Math.random()}`,
  name: '',
  qty: '',
  unit: '',
});

const ingredientDraftsFrom = (ingredients: MenuIngredient[] = []): IngredientDraft[] =>
  ingredients.length
    ? ingredients.map((ingredient, index) => ({
        key: `${index}-${ingredient.name}`,
        name: ingredient.name,
        qty: ingredient.qty === 0 ? '' : String(ingredient.qty),
        unit: ingredient.unit,
      }))
    : [emptyIngredient()];

const ingredientHasInput = (ingredient: IngredientDraft) =>
  ingredient.name.trim().length > 0 ||
  ingredient.qty.trim().length > 0 ||
  ingredient.unit.trim().length > 0;

const ingredientReady = (ingredient: IngredientDraft) => {
  if (!ingredientHasInput(ingredient)) return true;
  const qty = ingredient.qty.trim() === '' ? 0 : Number(ingredient.qty);
  return ingredient.name.trim().length > 0 && Number.isFinite(qty) && qty >= 0;
};

const cleanIngredients = (ingredients: IngredientDraft[]): MenuIngredient[] =>
  ingredients
    .filter(ingredientHasInput)
    .map((ingredient) => ({
      name: ingredient.name.trim(),
      qty: ingredient.qty.trim() === '' ? 0 : Number(ingredient.qty),
      unit: ingredient.unit.trim(),
    }));

export function MenuScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategoryId, setItemCategoryId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editIngredients, setEditIngredients] = useState<IngredientDraft[]>(() => [
    emptyIngredient(),
  ]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? null;

  const fillItemEditor = useCallback((item: MenuItem | null) => {
    setSelectedItemId(item?.id ?? null);
    setEditName(item?.nameEn ?? '');
    setEditPrice(item ? String(item.price) : '');
    setEditCategoryId(item?.categoryId ?? null);
    setEditIngredients(ingredientDraftsFrom(item?.ingredients ?? []));
  }, []);

  const fillCategoryEditor = useCallback((category: Category | null) => {
    setSelectedCategoryId(category?.id ?? null);
    setEditCategoryName(category?.nameEn ?? '');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextCategories, nextItems] = await Promise.all([
        fetchCategories(session.token),
        fetchMenu(session.token),
      ]);
      setCategories(nextCategories);
      setItems(nextItems);
      setError(null);
      setItemCategoryId((current) =>
        current && nextCategories.some((category) => category.id === current)
          ? current
          : nextCategories[0]?.id ?? null,
      );
      setEditCategoryId((current) =>
        current && nextCategories.some((category) => category.id === current)
          ? current
          : null,
      );
    } catch {
      setError('Could not load the menu.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedItemId) return;
    const item = items.find((candidate) => candidate.id === selectedItemId);
    if (!item) fillItemEditor(null);
  }, [fillItemEditor, items, selectedItemId]);

  useEffect(() => {
    if (!selectedCategoryId) return;
    const category = categories.find((candidate) => candidate.id === selectedCategoryId);
    if (!category) fillCategoryEditor(null);
  }, [categories, fillCategoryEditor, selectedCategoryId]);

  const groups = useMemo(() => {
    const byCategory = new Map<string | null, MenuItem[]>();
    for (const item of items) {
      const list = byCategory.get(item.categoryId) ?? [];
      list.push(item);
      byCategory.set(item.categoryId, list);
    }

    const ordered = categories.map((category) => ({
      id: category.id,
      name: category.nameEn,
      items: byCategory.get(category.id) ?? [],
    }));
    const uncategorized = byCategory.get(null) ?? [];
    return uncategorized.length
      ? [...ordered, { id: null, name: 'No category', items: uncategorized }]
      : ordered;
  }, [categories, items]);

  const availableCount = items.filter((item) => item.isAvailable).length;
  const categoryReady = categoryName.trim().length > 0;
  const parsedPrice = Number(itemPrice);
  const itemReady =
    itemName.trim().length > 0 &&
    itemPrice.trim().length > 0 &&
    Number.isInteger(parsedPrice) &&
    parsedPrice >= 0;
  const parsedEditPrice = Number(editPrice);
  const editReady =
    !!selectedItem &&
    editName.trim().length > 0 &&
    editPrice.trim().length > 0 &&
    Number.isInteger(parsedEditPrice) &&
    parsedEditPrice >= 0 &&
    editIngredients.every(ingredientReady);
  const categoryEditReady = !!selectedCategory && editCategoryName.trim().length > 0;

  const saveCategory = async () => {
    if (!categoryReady) return;
    setSavingCategory(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await addCategory(session.token, {
        ...sameName(categoryName),
        sortOrder: categories.length,
      });
      setCategories((current) => [...current, saved]);
      setItemCategoryId(saved.id);
      fillCategoryEditor(saved);
      setCategoryName('');
      setNotice('Category added.');
    } catch {
      setError('Could not add the category.');
    } finally {
      setSavingCategory(false);
    }
  };

  const saveCategoryEdit = async () => {
    if (!selectedCategory || !categoryEditReady) return;
    setSavingCategory(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await updateCategory(session.token, selectedCategory.id, {
        ...sameName(editCategoryName),
      });
      setCategories((current) =>
        current.map((category) => (category.id === saved.id ? saved : category)),
      );
      fillCategoryEditor(saved);
      setNotice('Category saved.');
    } catch {
      setError('Could not save the category.');
    } finally {
      setSavingCategory(false);
    }
  };

  const removeCategory = async () => {
    if (!selectedCategory) return;
    setSavingCategory(true);
    setNotice(null);
    setError(null);
    try {
      await deleteCategory(session.token, selectedCategory.id);
      setCategories((current) =>
        current.filter((category) => category.id !== selectedCategory.id),
      );
      setItems((current) =>
        current.map((item) =>
          item.categoryId === selectedCategory.id ? { ...item, categoryId: null } : item,
        ),
      );
      if (itemCategoryId === selectedCategory.id) setItemCategoryId(null);
      if (editCategoryId === selectedCategory.id) setEditCategoryId(null);
      fillCategoryEditor(null);
      setNotice('Category deleted.');
    } catch {
      setError('Could not delete the category.');
    } finally {
      setSavingCategory(false);
    }
  };

  const saveItem = async () => {
    if (itemName.trim().length === 0) {
      setNotice(null);
      setError('Add a dish name first.');
      return;
    }
    if (itemPrice.trim().length === 0) {
      setNotice(null);
      setError('Add a price first.');
      return;
    }
    if (!Number.isInteger(parsedPrice) || parsedPrice < 0) {
      setNotice(null);
      setError('Price must be a whole baht amount.');
      return;
    }
    setSavingItem(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await addMenuItem(session.token, {
        categoryId: itemCategoryId,
        ...sameName(itemName),
        price: parsedPrice,
        ingredients: [],
        sortOrder: items.length,
      });
      const next = { ...saved, optionGroups: [] };
      setItems((current) => [...current, next]);
      fillItemEditor(next);
      setItemName('');
      setItemPrice('');
      setNotice('Dish added.');
    } catch {
      setError('Could not add the dish.');
    } finally {
      setSavingItem(false);
    }
  };

  const saveItemEdit = async () => {
    if (!selectedItem || !editReady) return;
    const ingredients = cleanIngredients(editIngredients);
    setSavingEdit(true);
    setNotice(null);
    setError(null);
    try {
      await updateMenuItem(session.token, selectedItem.id, {
        categoryId: editCategoryId,
        ...sameName(editName),
        price: parsedEditPrice,
        ingredients,
      });
      const next = {
        ...selectedItem,
        categoryId: editCategoryId,
        nameTh: editName.trim(),
        nameEn: editName.trim(),
        price: parsedEditPrice,
        ingredients,
      };
      setItems((current) =>
        current.map((item) => (item.id === selectedItem.id ? next : item)),
      );
      fillItemEditor(next);
      setNotice('Dish saved.');
    } catch {
      setError('Could not save the dish.');
    } finally {
      setSavingEdit(false);
    }
  };

  const removeItem = async () => {
    if (!selectedItem) return;
    setSavingEdit(true);
    setNotice(null);
    setError(null);
    try {
      await deleteMenuItem(session.token, selectedItem.id);
      setItems((current) => current.filter((item) => item.id !== selectedItem.id));
      fillItemEditor(null);
      setNotice('Dish deleted.');
    } catch {
      setError('Could not delete the dish.');
    } finally {
      setSavingEdit(false);
    }
  };

  const chooseImage = async () => {
    if (!selectedItem) return;
    setSavingEdit(true);
    setNotice(null);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo permission is needed to add a dish picture.');
        return;
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset?.uri) return;

      const uploaded = await uploadMenuItemImage(session.token, selectedItem.id, {
        uri: asset.uri,
        name: asset.fileName ?? `${selectedItem.id}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setItems((current) =>
        current.map((item) =>
          item.id === selectedItem.id
            ? { ...item, imageUrl: uploaded.imageUrl }
            : item,
        ),
      );
      setNotice('Picture saved.');
    } catch {
      setError('Could not save the picture.');
    } finally {
      setSavingEdit(false);
    }
  };

  const removeImage = async () => {
    if (!selectedItem) return;
    setSavingEdit(true);
    setNotice(null);
    setError(null);
    try {
      await deleteMenuItemImage(session.token, selectedItem.id);
      setItems((current) =>
        current.map((item) =>
          item.id === selectedItem.id ? { ...item, imageUrl: null } : item,
        ),
      );
      setNotice('Picture removed.');
    } catch {
      setError('Could not remove the picture.');
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleAvailability = async (item: MenuItem) => {
    setBusyItemId(item.id);
    setNotice(null);
    setError(null);
    try {
      await setMenuItemAvailability(session.token, item.id, !item.isAvailable);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, isAvailable: !item.isAvailable }
            : candidate,
        ),
      );
      setNotice(!item.isAvailable ? 'Dish is back on.' : 'Dish marked sold out.');
    } catch {
      setError('Could not update the dish.');
    } finally {
      setBusyItemId(null);
    }
  };

  const updateIngredient = (
    key: string,
    field: keyof Omit<IngredientDraft, 'key'>,
    value: string,
  ) => {
    setEditIngredients((current) =>
      current.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, [field]: value } : ingredient,
      ),
    );
  };

  const removeIngredient = (key: string) => {
    setEditIngredients((current) => {
      const next = current.filter((ingredient) => ingredient.key !== key);
      return next.length > 0 ? next : [emptyIngredient()];
    });
  };

  const confirmDeleteCategory = () => {
    if (!selectedCategory) return;
    Alert.alert('Delete category?', 'Dishes stay in the menu without a category.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void removeCategory() },
    ]);
  };

  const confirmDeleteItem = () => {
    if (!selectedItem) return;
    Alert.alert('Delete dish?', 'Customers will not see this dish anymore.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void removeItem() },
    ]);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>MENU</Text>
          <Text style={styles.title} numberOfLines={1}>
            {session.stall.name}
          </Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="menu-back">
          <Text style={styles.home}>Home</Text>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <Metric label="Dishes" value={items.length} />
        <Metric label="Selling" value={availableCount} />
        <Metric label="Groups" value={categories.length} />
      </View>

      <View style={styles.form}>
        <Text style={styles.groupTitle}>Add Category</Text>
        <Field
          label="Category name"
          value={categoryName}
          onChangeText={setCategoryName}
          placeholder="Noodles"
          returnKeyType="done"
        />
        <Pressable
          style={[styles.button, (!categoryReady || savingCategory) && styles.buttonOff]}
          onPress={() => void saveCategory()}
          disabled={!categoryReady || savingCategory}
          testID="menu-add-category"
        >
          {savingCategory ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.buttonText}>Add category</Text>
          )}
        </Pressable>
      </View>

      {categories.length > 0 && (
        <View style={styles.form}>
          <Text style={styles.groupTitle}>Edit Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {categories.map((category) => (
              <CategoryChip
                key={category.id}
                label={category.nameEn}
                active={selectedCategoryId === category.id}
                onPress={() => fillCategoryEditor(category)}
              />
            ))}
          </ScrollView>
          {selectedCategory ? (
            <>
              <Field
                label="Category name"
                value={editCategoryName}
                onChangeText={setEditCategoryName}
                placeholder="Noodles"
              />
              <View style={styles.rowActions}>
                <Pressable
                  style={[
                    styles.button,
                    styles.rowButton,
                    (!categoryEditReady || savingCategory) && styles.buttonOff,
                  ]}
                  onPress={() => void saveCategoryEdit()}
                  disabled={!categoryEditReady || savingCategory}
                  testID="menu-save-category"
                >
                  <Text style={styles.buttonText}>Save</Text>
                </Pressable>
                <Pressable
                  style={[styles.dangerButton, styles.rowButton, savingCategory && styles.buttonOff]}
                  onPress={confirmDeleteCategory}
                  disabled={savingCategory}
                  testID="menu-delete-category"
                >
                  <Text style={styles.dangerText}>Delete</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={styles.muted}>Choose a category to edit.</Text>
          )}
        </View>
      )}

      <View style={styles.form}>
        <Text style={styles.groupTitle}>Add Dish</Text>
        <Field
          label="Dish name"
          value={itemName}
          onChangeText={setItemName}
          placeholder="Boat noodles"
          returnKeyType="next"
        />
        <Field
          label="Price"
          value={itemPrice}
          onChangeText={(value) => setItemPrice(value.replace(/[^0-9]/g, ''))}
          placeholder="60"
          inputMode="numeric"
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Category</Text>
        <CategoryPicker
          categories={categories}
          value={itemCategoryId}
          onChange={setItemCategoryId}
        />

        <Pressable
          style={[styles.button, (!itemReady || savingItem) && styles.buttonOff]}
          onPress={() => void saveItem()}
          disabled={savingItem}
          testID="menu-add-item"
        >
          {savingItem ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.buttonText}>Add dish</Text>
          )}
        </Pressable>
      </View>

      {selectedItem && (
        <View style={styles.form}>
          <Text style={styles.groupTitle}>Edit Dish</Text>
          <View style={styles.photoRow}>
            <View style={styles.photoBox}>
              {selectedItem.imageUrl ? (
                <Image
                  source={{ uri: imageUrlFor(selectedItem.imageUrl) }}
                  style={styles.photo}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.photoText}>No picture</Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Pressable
                style={[styles.smallButton, savingEdit && styles.buttonOff]}
                onPress={() => void chooseImage()}
                disabled={savingEdit}
                testID="menu-upload-image"
              >
                <Text style={styles.smallButtonText}>
                  {selectedItem.imageUrl ? 'Change picture' : 'Add picture'}
                </Text>
              </Pressable>
              {selectedItem.imageUrl && (
                <Pressable
                  style={[styles.smallGhostButton, savingEdit && styles.buttonOff]}
                  onPress={() => void removeImage()}
                  disabled={savingEdit}
                  testID="menu-remove-image"
                >
                  <Text style={styles.smallGhostText}>Remove picture</Text>
                </Pressable>
              )}
            </View>
          </View>

          <Field
            label="Dish name"
            value={editName}
            onChangeText={setEditName}
            placeholder="Boat noodles"
          />
          <Field
            label="Price"
            value={editPrice}
            onChangeText={(value) => setEditPrice(value.replace(/[^0-9]/g, ''))}
            placeholder="60"
            inputMode="numeric"
            keyboardType="number-pad"
          />
          <Text style={styles.label}>Category</Text>
          <CategoryPicker
            categories={categories}
            value={editCategoryId}
            onChange={setEditCategoryId}
          />
          <View style={styles.ingredientsHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Ingredients</Text>
              <Text style={styles.ingredientHint}>For forecasting only.</Text>
            </View>
            <Pressable
              style={styles.addIngredient}
              onPress={() =>
                setEditIngredients((current) => [...current, emptyIngredient()])
              }
              testID="menu-add-ingredient"
            >
              <Text style={styles.addIngredientText}>Add</Text>
            </Pressable>
          </View>
          {editIngredients.map((ingredient) => (
            <View key={ingredient.key} style={styles.ingredientRow}>
              <TextInput
                value={ingredient.name}
                onChangeText={(value) => updateIngredient(ingredient.key, 'name', value)}
                placeholder="Ingredient"
                placeholderTextColor={theme.muted}
                style={[styles.input, styles.ingredientName]}
              />
              <TextInput
                value={ingredient.qty}
                onChangeText={(value) =>
                  updateIngredient(ingredient.key, 'qty', value.replace(/[^0-9.]/g, ''))
                }
                placeholder="Qty"
                placeholderTextColor={theme.muted}
                inputMode="decimal"
                keyboardType="decimal-pad"
                style={[styles.input, styles.ingredientQty]}
              />
              <TextInput
                value={ingredient.unit}
                onChangeText={(value) => updateIngredient(ingredient.key, 'unit', value)}
                placeholder="Unit"
                placeholderTextColor={theme.muted}
                style={[styles.input, styles.ingredientUnit]}
              />
              <Pressable
                style={styles.removeIngredient}
                onPress={() => removeIngredient(ingredient.key)}
                hitSlop={8}
              >
                <Text style={styles.removeIngredientText}>-</Text>
              </Pressable>
            </View>
          ))}
          <View style={styles.rowActions}>
            <Pressable
              style={[
                styles.button,
                styles.rowButton,
                (!editReady || savingEdit) && styles.buttonOff,
              ]}
              onPress={() => void saveItemEdit()}
              disabled={!editReady || savingEdit}
              testID="menu-save-item"
            >
              {savingEdit ? (
                <ActivityIndicator color={theme.white} />
              ) : (
                <Text style={styles.buttonText}>Save</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.dangerButton, styles.rowButton, savingEdit && styles.buttonOff]}
              onPress={confirmDeleteItem}
              disabled={savingEdit}
              testID="menu-delete-item"
            >
              <Text style={styles.dangerText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={styles.section}>Current Menu</Text>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.ink} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No dishes yet</Text>
          <Text style={styles.emptyBody}>Add a dish above and it is ready for customers.</Text>
        </View>
      ) : (
        groups.map((group) =>
          group.items.length > 0 ? (
            <View key={group.id ?? 'none'} style={styles.group}>
              <Text style={styles.groupName}>{group.name}</Text>
              {group.items.map((item) => (
                <Pressable
                  key={item.id}
                  style={[
                    styles.item,
                    selectedItemId === item.id && styles.itemSelected,
                  ]}
                  onPress={() => fillItemEditor(item)}
                  testID={`menu-item-${item.id}`}
                >
                  <View style={styles.thumb}>
                    {item.imageUrl ? (
                      <Image
                        source={{ uri: imageUrlFor(item.imageUrl) }}
                        style={styles.thumbImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.thumbText}>PIC</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.nameEn}</Text>
                    <Text style={styles.itemMeta}>
                      {formatBaht(item.price)}
                      {item.optionGroups.length > 0
                        ? ` - ${item.optionGroups.length} option groups`
                        : ''}
                      {(item.ingredients?.length ?? 0) > 0
                        ? ` - ${item.ingredients?.length ?? 0} ingredients`
                        : ''}
                    </Text>
                  </View>
                  <Pressable
                    style={[
                      styles.availability,
                      !item.isAvailable && styles.availabilityOff,
                    ]}
                    onPress={() => void toggleAvailability(item)}
                    disabled={busyItemId === item.id}
                    testID={`menu-toggle-${item.id}`}
                  >
                    {busyItemId === item.id ? (
                      <ActivityIndicator
                        size="small"
                        color={item.isAvailable ? theme.white : theme.ink}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.availabilityText,
                          !item.isAvailable && styles.availabilityTextOff,
                        ]}
                      >
                        {item.isAvailable ? 'ON' : 'SOLD'}
                      </Text>
                    )}
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ) : null,
        )
      )}
      </ScrollView>
      <FloatingToast
        message={error ?? notice}
        tone={error ? 'error' : 'success'}
        onDone={() => {
          setError(null);
          setNotice(null);
        }}
      />
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

function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
    >
      <CategoryChip label="No category" active={value === null} onPress={() => onChange(null)} />
      {categories.map((category) => (
        <CategoryChip
          key={category.id}
          label={category.nameEn}
          active={value === category.id}
          onPress={() => onChange(category.id)}
        />
      ))}
    </ScrollView>
  );
}

function CategoryChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  scroll: { flex: 1 },
  body: { padding: 18, paddingBottom: 42, maxWidth: 620, width: '100%', alignSelf: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  mark: {
    fontSize: 12,
    letterSpacing: 4,
    color: theme.muted,
    fontWeight: '800',
    marginBottom: 8,
  },
  title: { fontSize: 30, lineHeight: 35, fontWeight: '800', color: theme.ink },
  home: { fontSize: 14, color: theme.muted, fontWeight: '800' },
  summary: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  metric: {
    flex: 1,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    paddingVertical: 12,
    paddingHorizontal: 8,
    minHeight: 76,
    justifyContent: 'center',
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
    color: theme.stool,
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 11,
    color: theme.muted,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  form: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 14,
    marginBottom: 12,
  },
  groupTitle: { fontSize: 20, fontWeight: '800', color: theme.ink, marginBottom: 14 },
  label: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    marginBottom: 14,
  },
  ingredientsHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 2,
    marginBottom: 8,
  },
  ingredientHint: {
    marginTop: -2,
    marginBottom: 0,
    color: theme.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  addIngredient: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 2,
    backgroundColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIngredientText: { color: theme.white, fontSize: 13, fontWeight: '900' },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  ingredientName: { flex: 1.4, marginBottom: 0, fontSize: 15, paddingHorizontal: 10 },
  ingredientQty: {
    flex: 0.7,
    marginBottom: 0,
    fontSize: 15,
    paddingHorizontal: 10,
  },
  ingredientUnit: {
    flex: 0.65,
    marginBottom: 0,
    fontSize: 15,
    paddingHorizontal: 10,
  },
  removeIngredient: {
    width: 32,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIngredientText: {
    color: theme.muted,
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '700',
  },
  chips: { gap: 8, paddingBottom: 14 },
  chip: {
    minHeight: 42,
    maxWidth: 180,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 21,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.white,
  },
  chipActive: {
    backgroundColor: theme.ink,
    borderColor: theme.ink,
  },
  chipText: { color: theme.ink, fontSize: 14, fontWeight: '800' },
  chipTextActive: { color: theme.white },
  button: {
    backgroundColor: theme.stool,
    minHeight: 54,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActions: { flexDirection: 'row', gap: 10 },
  rowButton: { flex: 1 },
  smallButton: {
    backgroundColor: theme.stool,
    minHeight: 46,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonText: { color: theme.white, fontSize: 14, fontWeight: '800' },
  smallGhostButton: {
    backgroundColor: theme.white,
    minHeight: 46,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallGhostText: { color: theme.ink, fontSize: 14, fontWeight: '800' },
  dangerButton: {
    minHeight: 54,
    borderRadius: 2,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.chilli,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: { color: theme.chilli, fontSize: 16, fontWeight: '800' },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: theme.white, fontSize: 16, fontWeight: '800' },
  muted: { color: theme.muted, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  photoRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  photoBox: {
    width: 104,
    height: 104,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: theme.ink,
    backgroundColor: theme.paper,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  photoText: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  section: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginTop: 8,
    marginBottom: 10,
  },
  loading: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 18,
  },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: theme.ink, marginBottom: 6 },
  emptyBody: { fontSize: 15, lineHeight: 22, color: theme.muted, fontWeight: '700' },
  group: { marginBottom: 12 },
  groupName: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.ink,
    marginBottom: 8,
  },
  item: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 12,
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  itemSelected: { borderColor: theme.ink, borderWidth: 2 },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: 3,
    backgroundColor: theme.paper,
    borderWidth: 1,
    borderColor: theme.rule,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbText: { color: theme.muted, fontSize: 11, fontWeight: '900' },
  itemName: { fontSize: 18, color: theme.ink, fontWeight: '800', marginBottom: 3 },
  itemMeta: { fontSize: 14, color: theme.muted, fontWeight: '700' },
  availability: {
    width: 72,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: theme.stool,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  availabilityOff: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
  },
  availabilityText: { color: theme.white, fontSize: 14, fontWeight: '900' },
  availabilityTextOff: { color: theme.ink },
  notice: {
    backgroundColor: theme.stool,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
    fontWeight: '800',
  },
  error: {
    backgroundColor: theme.chilli,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
  },
});
