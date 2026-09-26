const sizes = ['mediana', 'grande', 'familiar'];

export const productCategories = [
  { id:'pizzas', label:'Pizza', subcategories:['Clásicas','Especialidades','Gourmet'] },
  { id:'snacks', label:'Snacks', subcategories:['Papas','Empanizados'] },
  { id:'ensaladas', label:'Ensaladas', subcategories:['Clásicas','Especialidades'] },
  { id:'extras', label:'Extras', subcategories:['Bocadillos','Quesos'] },
  { id:'pastas', label:'Pastas', subcategories:['Clásicas','Alfredo'] },
  { id:'alitas_boneless', label:'Alitas y boneless', subcategories:['Alitas y boneless'] },
  { id:'hamburguesas', label:'Hamburguesas', subcategories:['Res','Pollo','Arrachera','Pastor','Especialidades'] },
  { id:'bebidas', label:'Bebidas', subcategories:['Frappes y malteadas','Refrescos y cafetería','Aguas, limonadas y naranjadas','Coctelería con y sin alcohol','Bebidas con alcohol'] }
];

export function configuredProductCategories(settings = {}, catalog = []) {
  const configured = Array.isArray(settings.catalogCategories) ? settings.catalogCategories : [];
  const byId = new Map(productCategories.map(category => [category.id, { ...category, subcategories:[...category.subcategories], builtin:true }]));
  for (const category of configured) {
    const id = String(category?.id || '').trim();
    const label = String(category?.label || '').trim();
    if (!id || !label) continue;
    const previous = byId.get(id);
    const configuredSubcategories = Array.isArray(category.subcategories)
      ? category.subcategories.map(value => String(value || '').trim()).filter(Boolean)
      : previous?.subcategories || [];
    byId.set(id, {
      id,
      label,
      builtin:previous?.builtin === true,
      subcategories:[...new Set(configuredSubcategories)]
    });
  }
  for (const product of catalog) {
    const id = productParentCategory(product);
    const subcategory = productSubcategory(product);
    const previous = byId.get(id) || { id, label:String(product.parentCategoryLabel || product.group || id).trim() || id, subcategories:[], builtin:false };
    byId.set(id, { ...previous, subcategories:[...new Set([...previous.subcategories, subcategory].filter(Boolean))] });
  }
  return [...byId.values()];
}

const pizzaSubcategories = { pizzas_clasicas:'Clásicas', pizzas_especialidades:'Especialidades', pizzas_gourmet:'Gourmet' };
const pizzaCategoryBySubcategory = { 'Clásicas':'pizzas_clasicas', 'Especialidades':'pizzas_especialidades', 'Gourmet':'pizzas_gourmet' };
function beverageSubcategory(product) {
  const name = String(product.name || '').toLocaleLowerCase('es-MX');
  if (/frappe|malteada/.test(name)) return 'Frappes y malteadas';
  if (/refresco|caf[eé]|t[eé]/.test(name)) return 'Refrescos y cafetería';
  if (/limonada|naranjada|agua/.test(name)) return 'Aguas, limonadas y naranjadas';
  if (/colado/.test(name)) return 'Coctelería con y sin alcohol';
  return 'Bebidas con alcohol';
}
function inferredSubcategory(product, parentCategory) {
  const name = String(product.name || '').toLocaleLowerCase('es-MX');
  if (parentCategory === 'bebidas') return beverageSubcategory(product);
  if (parentCategory === 'snacks') return /papa/.test(name) ? 'Papas' : 'Empanizados';
  if (parentCategory === 'ensaladas') return /casa|italiana/.test(name) ? 'Especialidades' : 'Clásicas';
  if (parentCategory === 'extras') return /queso fundido/.test(name) ? 'Quesos' : 'Bocadillos';
  if (parentCategory === 'pastas') return /alfredo/.test(name) ? 'Alfredo' : 'Clásicas';
  if (parentCategory === 'alitas_boneless') return 'Alitas y boneless';
  if (parentCategory === 'hamburguesas') {
    if (/pollo/.test(name)) return 'Pollo';
    if (/arrachera/.test(name)) return 'Arrachera';
    if (/pastor/.test(name)) return 'Pastor';
    if (/sencilla|doble/.test(name)) return 'Res';
    return 'Especialidades';
  }
  return 'General';
}
export function productParentCategory(product = {}) {
  return product.parentCategory || (String(product.category || '').startsWith('pizzas') || product.kind === 'pizza' ? 'pizzas' : product.category || 'extras');
}
export function productSubcategory(product = {}) {
  if (product.subcategory) return product.subcategory;
  if (pizzaSubcategories[product.category]) return pizzaSubcategories[product.category];
  const parentCategory = productParentCategory(product);
  const category = productCategories.find(item => item.id === productParentCategory(product));
  const group = String(product.group || '').trim();
  return group && group.toLocaleLowerCase('es-MX') !== String(category?.label || '').toLocaleLowerCase('es-MX') && group !== product.category
    ? group
    : inferredSubcategory(product, parentCategory);
}
export function normalizeProductHierarchy(product = {}) {
  const parentCategory = productParentCategory(product);
  const subcategory = productSubcategory(product);
  const category = parentCategory === 'pizzas' ? (pizzaCategoryBySubcategory[subcategory] || 'pizzas_clasicas') : parentCategory;
  return { ...product, category, parentCategory, subcategory, group:subcategory === 'General' ? (productCategories.find(item => item.id === parentCategory)?.label || product.group || parentCategory) : subcategory };
}

function normalizeName(item) {
  return item.nombre || item.nombre_menu_2 || item.nombre_menu_1 || item.nombre_en_menu || 'Platillo sin nombre';
}

function normalizePrices(item, category) {
  if (item.precios) return { ...item.precios };
  if (item.precio !== undefined) return { base: item.precio };
  if (item.precio_menu_2 !== undefined || item.precio_menu_1 !== undefined) {
    return { base: item.precio_menu_2 ?? item.precio_menu_1 };
  }
  if (category.precios_generales) return { ...category.precios_generales };
  return {};
}

function asChoices(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function itemChoices(item) {
  return asChoices([
    ...(item.sabores || []), ...(item.sabores_menu_1 || []), ...(item.sabores_menu_2 || []),
    ...(item.variantes || []), ...(item.opciones_ingredientes_menu_1 || []), ...(item.opciones_ingredientes_menu_2 || [])
  ]);
}

export function menuFromSource(source) {
  if (Array.isArray(source.catalog)) return source.catalog.map(product => normalizeProductHierarchy(product));
  const catalog = [];
  for (const category of source.categorias || []) {
    const categoryId = category.id;
    const isPizza = categoryId.startsWith('pizzas_');
    const groups = category.secciones?.flatMap(section => section.items.map(item => ({ item, subgroup: section.subcategoria })))
      || (category.platillos || []).map(item => ({ item, subgroup: category.categoria }));
    for (const { item, subgroup } of groups) {
      const name = normalizeName(item);
      const id = `${categoryId}-${catalog.length + 1}`;
      const prices = normalizePrices(item, category);
      const ingredients = item.ingredientes || item.ingredientes_menu_2 || item.ingredientes_menu_1 || item.descripcion || '';
      let choices = itemChoices(item);
      const choiceLabel = item.sabores || item.sabores_menu_1 || item.sabores_menu_2 ? 'Sabor'
        : item.opciones_ingredientes_menu_1 || item.opciones_ingredientes_menu_2 ? 'Relleno'
          : item.variantes ? 'Variante' : 'Elige una opción';
      let choiceGroups = choices.length ? [{ label: choiceLabel, options: choices }] : [];
      const splitChoiceGroup = /^(burritos|palitos de queso)\s*2\s*pz$/i.test(name) ? 'Relleno' : '';
      if (splitChoiceGroup) choiceGroups = [{ label: splitChoiceGroup, options: choices }];
      if (categoryId === 'alitas_boneless') choiceGroups = [
        { label: 'Presentación', options: ['Alitas · 8 piezas', 'Boneless · 200 g'] },
        { label: 'Sabor', options: choices }
      ];
      if (categoryId === 'bebidas' && name.toLowerCase() === 'café o té') choiceGroups = [
        { label: 'Elige una opción', options: ['Café', 'Té'] }
      ];
      const isColado = categoryId === 'bebidas' && /^colados?$/i.test(name);
      if (isColado) choiceGroups = [
        { label:'Tipo', options:['Sin alcohol','Con alcohol'] },
        { label:'Sabor', options:choices }
      ];
      const variants = item.precios && Object.keys(item.precios).some(key => !sizes.includes(key))
        ? Object.entries(item.precios).filter(([, value]) => value !== null).map(([label, price]) => ({ label: label[0].toUpperCase() + label.slice(1), price }))
        : [];
      catalog.push(normalizeProductHierarchy({
        id, name, category: categoryId, group: isPizza ? category.categoria.replace('Pizzas ', '') : subgroup,
        kind: isPizza ? 'pizza' : 'dish', price: Object.values(prices).find(value => typeof value === 'number') ?? 0,
        prices, description: ingredients, choices, choiceGroups,
        variants, active: true, ...(splitChoiceGroup ? { splitChoiceGroup } : {}),
        ...(isColado ? { alcoholCategories:['sin-alcohol','alcohol'] } : {}),
        presentInMenu1: item.presente_en_menu_1 !== false,
        presentInMenu2: item.presente_en_menu_2 !== false
      }));
    }
    if (category.suplementos) {
      const supplement = category.suplementos;
      catalog.push(normalizeProductHierarchy({
        id: `${categoryId}-orilla`, name: supplement.nombre, category: categoryId, group: 'Complementos',
        kind: 'supplement', price: supplement.precios.mediana, prices: { ...supplement.precios },
        description: 'Se agrega a una pizza de cualquier tamaño.', choices: [], variants: [], active: true
      }));
    }
  }
  return catalog;
}

export function selectableProducts(catalog = [], settings = {}) {
  const available = catalog.filter(product => product.active !== false && product.kind !== 'supplement');
  const pizzaOptions = available.filter(product => product.kind === 'pizza');
  const activeSizeIds = new Set(configuredPizzaSizes(settings).filter(size => size.active !== false).map(size => size.id));
  const pizzaPrices = pizzaOptions.flatMap(product => Object.entries(product.prices || {}).filter(([size]) => activeSizeIds.has(size)).map(([, price]) => price)).map(Number).filter(price => Number.isFinite(price) && price > 0);
  const pizzaMenu = pizzaOptions.length ? [{
    id: 'pizza-menu', name: 'Pizza', category: 'pizzas', group: 'Clásicas · Especialidades · Gourmet',
    kind: 'pizza-menu', pizzaOptions, description: `${pizzaOptions.length} sabores para elegir · masa horneada a la leña`,
    price: pizzaPrices.length ? Math.min(...pizzaPrices) : 0
  }] : [];
  const dishes = available.filter(product => product.kind !== 'pizza');
  const definitions = [
    { id: 'snacks', name: 'Snacks', category: 'snacks', label: 'Elige el platillo', match: product => product.category === 'snacks', option: product => product.name },
    { id: 'extras', name: 'Extras', category: 'extras', label: 'Elige el extra', match: product => product.category === 'extras', option: product => product.name },
    { id: 'hamburguesas', name: 'Hamburguesa', category: 'hamburguesas', label: 'Tipo de hamburguesa', match: product => product.category === 'hamburguesas', option: product => product.name },
    { id: 'ensaladas', name: 'Ensalada', category: 'ensaladas', label: 'Preparación', match: product => product.category === 'ensaladas', option: product => {
      const name = product.name.replace(/^ensalada\s*/i, '');
      const normalized = name.toLocaleLowerCase('es-MX') === 'cesar' ? 'César' : name;
      return normalized.charAt(0).toLocaleUpperCase('es-MX') + normalized.slice(1);
    } },
    { id: 'pastas', name: 'Pasta', category: 'pastas', label: 'Especialidad', match: product => product.category === 'pastas', option: product => product.name },
  ];
  const families = [];
  const consumed = new Set();
  for (const definition of definitions) {
    const members = dishes.filter(definition.match);
    if (members.length < 2) continue;
    members.forEach(member => consumed.add(member.id));
    const options = members.map(product => ({ id: product.id, label: definition.option(product), product }));
    const prices = members.flatMap(product => product.variants?.length
      ? product.variants.map(variant => Number(variant.price) || 0)
      : [Number(product.price) || 0]);
    families.push({
      id: `family-${definition.id}`, name: definition.name, category: definition.category, categories: definition.categories || [definition.category],
      group: members[0].group || definition.category, kind: 'family',
      familyChoiceGroup: { label: definition.label, options }, familyOptions: options,
      description: `${options.length} opciones para elegir`, price: Math.min(...prices)
    });
  }
  const beverages = dishes.filter(product => product.category === 'bebidas');
  const isColado = product => /^colados?$/i.test(product.name);
  const isAlcoholic = product => /margarita|cerveza|michelada|mojito|clericot/i.test(product.name);
  const beverageOption = product => ({ id: product.id, label: product.name, product });
  const beverageGroups = [
    {
      id: 'sin-alcohol', label: 'Sin alcohol',
      options: beverages.filter(product => product.alcoholCategories?.includes('sin-alcohol') || !isAlcoholic(product)).map(beverageOption)
    },
    {
      id: 'alcohol', label: 'Alcohol',
      options: beverages.filter(product => product.alcoholCategories?.includes('alcohol') || isAlcoholic(product) || isColado(product)).map(beverageOption)
    }
  ].filter(group => group.options.length);
  beverages.forEach(product => consumed.add(product.id));
  const beveragePrices = beverages.flatMap(product => product.variants?.length
    ? product.variants.map(variant => Number(variant.price) || 0)
    : [Number(product.price) || 0]);
  const beverageMenu = beverages.length ? [{
    id: 'beverage-menu', name: 'Bebidas', category: 'bebidas', group: 'Con y sin alcohol', kind: 'beverage-menu',
    beverageGroups, description: 'Todas las bebidas en una sola selección · elige categoría, bebida y presentación', price: Math.min(...beveragePrices)
  }] : [];
  return [...pizzaMenu, ...families, ...beverageMenu, ...dishes.filter(product => !consumed.has(product.id))];
}

export function formatTicketDetails(item) {
  const details = String(item.details || '');
  if (item.category === 'hamburguesas') {
    const parts = details.split(' · ').map(part => part.trim()).filter(Boolean);
    return [parts[0], ...parts.slice(1).filter(part => /^sin\s+/i.test(part))].filter(Boolean).join(' · ');
  }
  if (item.name !== 'Pizza' && !item.category?.startsWith('pizzas_')) return details;
  return details.replace(/\bmitad\s*[12]\s*/gi, '').replace(/\s*\/\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim();
}

export function priceForProduct(product, size, variant) {
  if (product.kind === 'pizza') return Number(product.prices?.[size] ?? product.price ?? 0);
  if (product.kind === 'supplement' && size) return Number(product.prices?.[size] ?? 0);
  if (variant) {
    const selected = product.variants?.find(option => option.label.toLowerCase() === variant.toLowerCase());
    if (selected) return Number(selected.price);
    const key = variant.toLowerCase();
    if (product.prices?.[key] !== undefined) return Number(product.prices[key] ?? 0);
  }
  return Number(product.price ?? 0);
}

export function formatMoney(amount, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

export const pizzaSizes = [
  { id: 'mediana', name: 'Mediana', detail: '30 cm · 8 rebanadas', active: true, basePrice: 200, adjustments: { Especialidades: 20, Gourmet: 50 }, cheeseRimPrice: 30 },
  { id: 'grande', name: 'Grande', detail: '36 cm · 12 rebanadas', active: true, basePrice: 220, adjustments: { Especialidades: 50, Gourmet: 70 }, cheeseRimPrice: 50 },
  { id: 'familiar', name: 'Familiar', detail: '40 cm · 16 rebanadas', active: true, basePrice: 250, adjustments: { Especialidades: 50, Gourmet: 80 }, cheeseRimPrice: 70 }
];

export function configuredPizzaSizes(settings = {}) {
  const source = Array.isArray(settings.pizzaSizes) && settings.pizzaSizes.length ? settings.pizzaSizes : pizzaSizes;
  return source.map(size => ({
    id: String(size.id || '').trim(), name: String(size.name || '').trim(), detail: String(size.detail || '').trim(),
    active: size.active !== false, basePrice: Number(size.basePrice) || 0,
    adjustments: { Especialidades: Number(size.adjustments?.Especialidades) || 0, Gourmet: Number(size.adjustments?.Gourmet) || 0 },
    cheeseRimPrice: Number(size.cheeseRimPrice) || 0
  }));
}

export function pizzaPriceForSubcategory(size, subcategory = 'Clásicas') {
  return Number(size?.basePrice || 0) + Number(size?.adjustments?.[subcategory] || 0);
}
