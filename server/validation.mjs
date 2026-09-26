import { randomUUID } from 'node:crypto';
import {
  configuredPizzaSizes,
  normalizeProductHierarchy,
  priceForProduct,
  productCategories,
  productParentCategory,
  productSubcategory
} from '../src/domain/menu-model.js';

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

const finiteAmount = (value, { minimum = 0, maximum = 100_000, integer = false } = {}) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < minimum || amount > maximum || (integer && !Number.isSafeInteger(amount))) {
    throw new ValidationError('Se recibió un importe fuera del rango permitido.');
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

export const cleanText = (value, maximum = 300) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);

const stationFor = product => product.kind === 'pizza' || product.category?.startsWith('pizzas')
  ? 'Pizzas'
  : product.category === 'bebidas' ? 'Bebidas' : 'Platillos';

const displayNameFor = product => ({
  bebidas: 'Bebida', hamburguesas: 'Hamburguesa', pastas: 'Pasta', ensaladas: 'Ensalada'
}[productParentCategory(product)] || product.name);

function canonicalPizza(raw, product, catalog, settings) {
  const configuration = raw.configuration && typeof raw.configuration === 'object' ? raw.configuration : {};
  const sizes = configuredPizzaSizes(settings).filter(size => size.active !== false);
  const size = sizes.find(entry => entry.id === configuration.size);
  if (!size) throw new ValidationError('Selecciona un tamaño de pizza habilitado.');
  const mode = configuration.mode === 'mitades' ? 'mitades' : configuration.mode === 'completa' ? 'completa' : '';
  if (!mode) throw new ValidationError('Selecciona pizza completa o mitad y mitad.');
  const pizzaProducts = catalog.filter(entry => entry.kind === 'pizza' && entry.active !== false);
  const left = pizzaProducts.find(entry => entry.id === (configuration.leftProductId || raw.productId));
  const right = mode === 'mitades'
    ? pizzaProducts.find(entry => entry.id === configuration.rightProductId)
    : left;
  if (!left || !right) throw new ValidationError('Uno de los sabores de pizza no está disponible.');
  const leftPrice = finiteAmount(priceForProduct(left, size.id), { minimum: 0.01 });
  const rightPrice = finiteAmount(priceForProduct(right, size.id), { minimum: 0.01 });
  let unitPrice = mode === 'mitades' ? (leftPrice + rightPrice) / 2 : leftPrice;
  const cheeseRim = configuration.cheeseRim === true;
  if (cheeseRim) {
    const supplement = catalog.find(entry => entry.kind === 'supplement' && entry.active !== false);
    if (!supplement) throw new ValidationError('La orilla de queso no está disponible.');
    unitPrice += finiteAmount(priceForProduct(supplement, size.id), { minimum: 0 });
  }
  const flavors = mode === 'mitades' ? `${left.name} / ${right.name}` : left.name;
  return {
    name: 'Pizza', productId: left.id, category: left.category,
    parentCategory: productParentCategory(left), subcategory: productSubcategory(left),
    station: 'Pizzas', unitPrice: finiteAmount(unitPrice, { minimum: 0.01 }),
    details: `${size.name} · ${flavors}${cheeseRim ? ' · Orilla de queso' : ''}`,
    configuration: { type: 'pizza', size:size.id, mode, leftProductId:left.id, rightProductId:right.id, cheeseRim }
  };
}

function canonicalDish(raw, product) {
  if (product.kind !== 'dish') throw new ValidationError('El producto seleccionado no se puede agregar directamente.');
  const configuration = raw.configuration && typeof raw.configuration === 'object' ? raw.configuration : {};
  const requestedChoices = configuration.choices && typeof configuration.choices === 'object' ? configuration.choices : {};
  const allGroups = (product.choiceGroups || []).filter(group => !(product.category === 'hamburguesas' && group.label === 'Queso'));
  const isWings = productParentCategory(product) === 'alitas_boneless';
  const splitChoiceLabel = cleanText(product.splitChoiceGroup || (isWings ? 'Sabor' : ''), 80);
  const splitGroup = splitChoiceLabel ? allGroups.find(group => group.label === splitChoiceLabel) : null;
  const groups = splitGroup ? allGroups.filter(group => group !== splitGroup) : allGroups;
  const allowedLabels = new Set(allGroups.map(group => group.label));
  if (Object.keys(requestedChoices).some(label => !allowedLabels.has(label))) throw new ValidationError('Se recibió una opción que no pertenece al platillo.');
  const choices = {};
  for (const group of groups) {
    const options = Array.isArray(group.options) ? group.options : [];
    const selected = requestedChoices[group.label] || options[0];
    if (!options.includes(selected)) throw new ValidationError(`La opción de ${group.label} no está disponible.`);
    choices[group.label] = selected;
  }
  let flavorMode = '';
  let leftFlavor = '';
  let rightFlavor = '';
  if (splitGroup) {
    const flavors = Array.isArray(splitGroup.options) ? splitGroup.options : [];
    flavorMode = configuration.flavorMode === 'mitades' ? 'mitades' : 'completa';
    leftFlavor = cleanText(configuration.leftFlavor || requestedChoices.Sabor || flavors[0], 80);
    rightFlavor = flavorMode === 'mitades' ? cleanText(configuration.rightFlavor, 80) : leftFlavor;
    if (!flavors.includes(leftFlavor) || !flavors.includes(rightFlavor)) throw new ValidationError(`Selecciona una o dos opciones válidas para ${splitChoiceLabel.toLocaleLowerCase('es-MX')}.`);
    choices[splitChoiceLabel] = flavorMode === 'mitades' ? `${leftFlavor} / ${rightFlavor}` : leftFlavor;
  }
  if (/^colados?$/i.test(product.name) && choices.Tipo === 'Sin alcohol' && choices.Sabor === 'Baileys') throw new ValidationError('Baileys solo está disponible en Colados con alcohol.');
  let variant = '';
  if (Array.isArray(product.variants) && product.variants.length) {
    variant = cleanText(configuration.variant, 80);
    if (!product.variants.some(entry => entry.label === variant)) throw new ValidationError('Selecciona una presentación válida.');
  }
  const ingredientOptions = product.ingredientOptions || [];
  const excludedIngredients = Array.isArray(configuration.excludedIngredients)
    ? [...new Set(configuration.excludedIngredients.map(value => cleanText(value, 80)))] : [];
  if (excludedIngredients.some(ingredient => !ingredientOptions.includes(ingredient))) throw new ValidationError('Se intentó retirar un ingrediente que no pertenece al platillo.');
  const unitPrice = finiteAmount(priceForProduct(product, '', variant), { minimum: 0.01 });
  const details = [product.name, ...Object.values(choices), ...excludedIngredients.map(ingredient => `Sin ${ingredient.toLocaleLowerCase('es-MX')}`), variant].filter(Boolean).join(' · ');
  return {
    name: displayNameFor(product), productId: product.id, category: product.category,
    parentCategory: productParentCategory(product), subcategory: productSubcategory(product),
    station: stationFor(product), unitPrice, details,
    configuration: { type:'dish', choices, variant, excludedIngredients, ...(splitGroup ? { flavorMode, leftFlavor, rightFlavor } : {}) }
  };
}

export function canonicalizeItems(rawItems, catalog, settings) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 100) throw new ValidationError('Agrega entre 1 y 100 partidas al pedido.');
  return rawItems.map(raw => {
    if (!raw || typeof raw !== 'object') throw new ValidationError('Una partida del pedido no es válida.');
    const quantity = finiteAmount(raw.quantity, { minimum: 1, maximum: 50, integer: true });
    const product = catalog.find(entry => entry.id === raw.productId && entry.active !== false);
    if (!product) throw new ValidationError('Uno de los productos ya no está disponible.');
    const item = product.kind === 'pizza'
      ? canonicalPizza(raw, product, catalog, settings)
      : canonicalDish(raw, product);
    return { ...item, quantity, note:cleanText(raw.note, 300), lineId:randomUUID() };
  });
}

export function validateOrderMetadata(body, settings, orders, { existingOrderId = null } = {}) {
  const type = body.type;
  if (!['mesa', 'domicilio', 'recoger'].includes(type)) throw new ValidationError('Selecciona mesa, domicilio o recoger en el restaurante.');
  const metadata = {
    type,
    source: type === 'recoger' ? (body.source === 'mostrador' ? 'mostrador' : 'telefono') : undefined,
    customerName: cleanText(body.customerName, 100),
    phone: cleanText(body.phone, 20),
    address: cleanText(body.address, 240),
    orderNote: cleanText(body.orderNote, 500)
  };
  if (type === 'mesa') {
    const table = Number(body.table);
    const guests = Number(body.guests);
    const tableCount = Number(settings.tableCount || 12);
    if (!Number.isSafeInteger(table) || table < 1 || table > tableCount) throw new ValidationError(`Selecciona una mesa entre 1 y ${tableCount}.`);
    if (!Number.isSafeInteger(guests) || guests < 1 || guests > 30) throw new ValidationError('Indica entre 1 y 30 comensales.');
    if (orders.some(order => order.id !== existingOrderId && order.type === 'mesa' && String(order.table) === String(table) && !['cerrado','cancelado','cerrado_turno'].includes(order.status))) {
      throw new ValidationError(`La mesa ${table} ya tiene un pedido abierto.`, 409);
    }
    metadata.table = String(table);
    metadata.guests = guests;
  } else {
    if (!metadata.customerName) throw new ValidationError('Escribe el nombre del cliente.');
    const digits = metadata.phone.replace(/\D/g, '');
    if (digits.length !== 10) throw new ValidationError('Escribe un teléfono de 10 dígitos.');
    metadata.phone = `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    if (type === 'domicilio' && !metadata.address) throw new ValidationError('Escribe la dirección de entrega.');
  }
  return metadata;
}

const sanitizeOptions = (values, maximum = 50) => {
  if (!Array.isArray(values) || values.length > maximum) throw new ValidationError('La lista de opciones del producto no es válida.');
  return [...new Set(values.map(value => cleanText(value, 80)).filter(Boolean))];
};

export function validateCatalogCategories(entries, catalog = []) {
  if (!Array.isArray(entries) || entries.length < productCategories.length || entries.length > 60) throw new ValidationError(`La carta debe conservar sus ${productCategories.length} categorías base y admite hasta 60 categorías.`);
  const ids = new Set(); const labels = new Set();
  const categories = entries.map(entry => {
    const id = cleanText(entry?.id, 100);
    const label = cleanText(entry?.label, 80);
    if (!/^[a-z0-9][a-z0-9_-]{1,99}$/i.test(id) || !label) throw new ValidationError('Cada categoría necesita un nombre válido.');
    const labelKey = label.toLocaleLowerCase('es-MX');
    if (ids.has(id) || labels.has(labelKey)) throw new ValidationError('No puede haber categorías repetidas.');
    const subcategories = sanitizeOptions(entry.subcategories || [], 50);
    if (!subcategories.length) throw new ValidationError(`Agrega al menos una subcategoría a ${label}.`);
    if (new Set(subcategories.map(value => value.toLocaleLowerCase('es-MX'))).size !== subcategories.length) throw new ValidationError(`Hay subcategorías repetidas en ${label}.`);
    ids.add(id); labels.add(labelKey);
    return { id, label, subcategories };
  });
  const missingBuiltin = productCategories.find(category => !ids.has(category.id));
  if (missingBuiltin) throw new ValidationError(`La categoría base ${missingBuiltin.label} debe permanecer disponible.`);
  const missingUsed = catalog.find(product => !ids.has(productParentCategory(product)));
  if (missingUsed) throw new ValidationError(`No puedes eliminar la categoría usada por ${missingUsed.name}.`);
  const missingUsedSubcategory = catalog.find(product => {
    const category = categories.find(entry => entry.id === productParentCategory(product));
    return category && !category.subcategories.includes(productSubcategory(product));
  });
  if (missingUsedSubcategory) throw new ValidationError(`No puedes eliminar la subcategoría ${productSubcategory(missingUsedSubcategory)} porque contiene productos.`);
  return categories;
}

export function validateCatalog(entries, categoryDefinitions = productCategories) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) throw new ValidationError('La carta debe contener entre 1 y 500 productos.');
  const validParents = new Map(categoryDefinitions.map(category => [category.id, new Set(category.subcategories || [])]));
  const ids = new Set();
  const identities = new Set();
  return entries.map(entry => {
    const normalized = normalizeProductHierarchy(entry);
    const id = cleanText(normalized.id, 100);
    const name = cleanText(normalized.name, 100);
    const parentCategory = cleanText(normalized.parentCategory, 40);
    const subcategory = cleanText(normalized.subcategory, 80);
    if (!/^[a-z0-9][a-z0-9._-]{1,99}$/i.test(id) || !name) throw new ValidationError('Cada producto necesita un identificador y nombre válidos.');
    if (ids.has(id)) throw new ValidationError(`El identificador ${id} está repetido.`);
    if (!validParents.has(parentCategory) || !subcategory || !validParents.get(parentCategory).has(subcategory)) throw new ValidationError(`Revisa la categoría y subcategoría de ${name}.`);
    const identity = `${parentCategory}|${subcategory}|${name}`.toLocaleLowerCase('es-MX');
    if (identities.has(identity)) throw new ValidationError(`${name} está repetido en la misma subcategoría.`);
    const kind = normalized.kind === 'pizza' || normalized.kind === 'supplement' ? normalized.kind : 'dish';
    const price = finiteAmount(normalized.price, { minimum: 0.01 });
    const prices = {};
    for (const [key, value] of Object.entries(normalized.prices || {})) {
      const safeKey = cleanText(key, 40);
      if (!safeKey || Object.keys(prices).length >= 20) throw new ValidationError(`Revisa los precios de ${name}.`);
      prices[safeKey] = finiteAmount(value, { minimum: 0 });
    }
    const variants = Array.isArray(normalized.variants) ? normalized.variants : [];
    if (variants.length > 30) throw new ValidationError(`${name} tiene demasiadas presentaciones.`);
    const cleanVariants = variants.map(variant => ({ label:cleanText(variant.label, 80), price:finiteAmount(variant.price, { minimum:0.01 }) }));
    if (cleanVariants.some(variant => !variant.label) || new Set(cleanVariants.map(variant => variant.label.toLocaleLowerCase('es-MX'))).size !== cleanVariants.length) throw new ValidationError(`Revisa las presentaciones de ${name}.`);
    const choiceGroups = Array.isArray(normalized.choiceGroups) ? normalized.choiceGroups : [];
    if (choiceGroups.length > 12) throw new ValidationError(`${name} tiene demasiados grupos de opciones.`);
    const cleanGroups = choiceGroups.map(group => ({ label:cleanText(group.label, 80), options:sanitizeOptions(group.options) }));
    if (cleanGroups.some(group => !group.label || group.options.length === 0)) throw new ValidationError(`Revisa las opciones de ${name}.`);
    ids.add(id); identities.add(identity);
    const splitChoiceGroup = cleanText(normalized.splitChoiceGroup, 80);
    if (splitChoiceGroup && !cleanGroups.some(group => group.label === splitChoiceGroup)) throw new ValidationError(`La opción mitad y mitad de ${name} no coincide con sus grupos.`);
    const alcoholCategories = sanitizeOptions(normalized.alcoholCategories || [], 2).filter(value => ['sin-alcohol','alcohol'].includes(value));
    return {
      id, name, category:normalized.category, parentCategory, subcategory,
      group:cleanText(normalized.group || subcategory, 80), kind, price, prices,
      description:cleanText(normalized.description, 500),
      choices:sanitizeOptions(normalized.choices || []), choiceGroups:cleanGroups,
      variants:cleanVariants, ingredientOptions:sanitizeOptions(normalized.ingredientOptions || []),
      ...(splitChoiceGroup ? { splitChoiceGroup } : {}), ...(alcoholCategories.length ? { alcoholCategories } : {}),
      active:normalized.active !== false,
      presentInMenu1:normalized.presentInMenu1 !== false,
      presentInMenu2:normalized.presentInMenu2 !== false
    };
  });
}

export function validateSettings(input, current = {}) {
  const restaurantName = cleanText(input.restaurantName ?? current.restaurantName, 100);
  const phoneDigits = String(input.phone ?? current.phone ?? '').replace(/\D/g, '');
  const tableCount = Number(input.tableCount ?? current.tableCount);
  const paperWidth = input.paperWidth ?? current.paperWidth;
  if (!restaurantName) throw new ValidationError('Escribe el nombre del restaurante.');
  if (phoneDigits.length !== 10) throw new ValidationError('El teléfono de la sucursal debe tener 10 dígitos.');
  if (!Number.isSafeInteger(tableCount) || tableCount < 1 || tableCount > 100) throw new ValidationError('Configura entre 1 y 100 mesas.');
  if (!['58mm','80mm'].includes(paperWidth)) throw new ValidationError('Selecciona un ancho de ticket válido.');
  return {
    ...current,
    restaurantName,
    phone:`${phoneDigits.slice(0,3)}-${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`,
    tableCount,
    paperWidth,
    currency:'MXN',
    socialNote:cleanText(input.socialNote ?? current.socialNote, 240)
  };
}

export function validateRawMaterials(entries, categories = []) {
  if (!Array.isArray(entries) || entries.length > 1000) throw new ValidationError('El inventario admite hasta 1000 materias primas.');
  if (!Array.isArray(categories) || categories.length > 100) throw new ValidationError('La lista de categorías no es válida.');
  const categoryByName = new Map();
  for (const value of categories) {
    const category = cleanText(value, 80);
    const key = category.toLocaleLowerCase('es-MX');
    if (category && !categoryByName.has(key)) categoryByName.set(key, category);
  }
  const ids = new Set(); const names = new Set();
  const materials = entries.map(entry => {
    const id = cleanText(entry.id || randomUUID(), 100);
    const name = cleanText(entry.name, 100);
    const requestedCategory = cleanText(entry.category, 80);
    const categoryKey = requestedCategory.toLocaleLowerCase('es-MX');
    const category = categoryByName.get(categoryKey) || requestedCategory;
    const stock = finiteAmount(entry.stock, { minimum:0, maximum:1_000_000_000 });
    if (!id || !name || !category) throw new ValidationError('Cada materia prima necesita nombre y categoría.');
    const nameKey = name.toLocaleLowerCase('es-MX');
    if (ids.has(id) || names.has(nameKey)) throw new ValidationError(`${name} está repetida en el inventario.`);
    if (!categoryByName.has(categoryKey)) categoryByName.set(categoryKey, category);
    ids.add(id); names.add(nameKey);
    return { id, name, category, stock };
  });
  const cleanCategories = [...categoryByName.values()];
  if (cleanCategories.length > 100) throw new ValidationError('El inventario admite hasta 100 categorías.');
  return { materials, categories:cleanCategories };
}
