import * as THREE from 'three';

const activeAnimations = new Set();

const palette = {
  crust: 0xc9b28b,
  crustLight: 0xe2cfac,
  cheese: 0xf5f0df,
  cheeseShadow: 0xe8dfca,
  plate: 0xfafaf7,
  plateLine: 0xd8d9d2,
  left: 0xb9d4eb,
  right: 0xefc3bd,
  leftInk: 0x4b78a1,
  rightInk: 0xa34d48,
  leftGlow: 0x9acfff,
  rightGlow: 0xffaaa0,
  pepperoni: 0xa94e45,
  pepperoniEdge: 0x743b38,
  herb: 0x6d8060,
  mushroom: 0xd8c8b0
};

const toppingsFor = name => {
  const value = String(name || '').toLocaleLowerCase('es-MX');
  if (/champi|vegetar|margarita/.test(value)) return 'vegetales';
  if (/camar[oó]n|boneless|pastor|arrachera/.test(value)) return 'mixto';
  return 'pepperoni';
};

function halfGeometry(left, radius = 0.985) {
  const shape = new THREE.Shape();
  const start = left ? Math.PI / 2 : -Math.PI / 2;
  const end = left ? (Math.PI * 3) / 2 : Math.PI / 2;
  shape.moveTo(0, 0);
  for (let index = 0; index <= 36; index += 1) {
    const angle = start + (end - start) * index / 36;
    shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  shape.lineTo(0, 0);
  return new THREE.ShapeGeometry(shape, 36);
}

function toppingPoint(index, radius = 0.76) {
  const ring = index < 7 ? 0 : 1;
  const position = ring === 0 ? index : index - 7;
  const count = ring === 0 ? 7 : 8;
  const angle = Math.PI * 2 * position / count + ring * 0.22 + 0.2;
  const distance = ring === 0 ? radius * 0.4 : radius * 0.78;
  return [Math.cos(angle) * distance, Math.sin(angle) * distance];
}

function addToppings(group, half, name, colorize, offset = 0) {
  const style = toppingsFor(name);
  const red = colorize ? palette.pepperoni : 0x77756e;
  const olive = colorize ? palette.herb : 0x85847d;
  const mushroom = colorize ? palette.mushroom : 0xbab8b0;
  const pepperoniMaterial = new THREE.MeshStandardMaterial({ color: red, roughness: 0.78 });
  const pepperoniEdgeMaterial = new THREE.MeshStandardMaterial({ color: colorize ? palette.pepperoniEdge : 0x595852, roughness: 0.82 });
  const vegetableMaterial = new THREE.MeshStandardMaterial({ color: olive, roughness: 0.83 });
  const creamMaterial = new THREE.MeshStandardMaterial({ color: mushroom, roughness: 0.8 });
  const pepperoniGeometry = new THREE.CylinderGeometry(0.103, 0.108, 0.035, 24);
  const pepperoniRingGeometry = new THREE.TorusGeometry(0.087, 0.008, 6, 20);
  const centerGeometry = new THREE.SphereGeometry(0.017, 10, 6);
  const oilGeometry = new THREE.CircleGeometry(0.046, 16);
  const oilMaterial = new THREE.MeshStandardMaterial({ color: colorize ? 0xd98a57 : 0x8f8d86, transparent: true, opacity: .34, roughness: .28, metalness: .05 });
  const pieceGeometry = new THREE.IcosahedronGeometry(0.073, 1);
  for (let index = 0; index < 15; index += 1) {
    const [x0, y0] = toppingPoint((index + offset) % 15);
    const inHalf = half === 'all' || (half === 'left' ? x0 <= 0 : x0 > 0);
    if (!inHalf) continue;
    const x = x0 * 0.92;
    const y = y0 * 0.92;
    const z = 0.17 + index % 3 * 0.003;
    if (style === 'pepperoni' || (style === 'mixto' && index % 2 === 0)) {
      const topping = new THREE.Mesh(pepperoniGeometry, pepperoniMaterial);
      topping.rotation.x = Math.PI / 2;
      topping.position.set(x, y, z);
      group.add(topping);
      const oil = new THREE.Mesh(oilGeometry, oilMaterial);
      oil.position.set(x + .028, y - .014, z + .025);
      oil.rotation.z = index * .47;
      oil.scale.set(1.35, .72, 1);
      group.add(oil);
      const ring = new THREE.Mesh(pepperoniRingGeometry, pepperoniEdgeMaterial);
      ring.position.set(x, y, z + 0.022);
      group.add(ring);
      const center = new THREE.Mesh(centerGeometry, creamMaterial);
      center.position.set(x, y, z + 0.026);
      group.add(center);
    } else {
      const topping = new THREE.Mesh(pieceGeometry, index % 2 ? vegetableMaterial : creamMaterial);
      topping.position.set(x, y, z);
      topping.scale.set(1.36, 0.86, 0.38);
      topping.rotation.z = index * 0.63;
      group.add(topping);
    }
  }
}

function addCheeseDetails(group, half, colorize, offset = 0) {
  const cheese = new THREE.MeshStandardMaterial({ color: colorize ? 0xf2d991 : 0xd8d5c9, roughness: 0.76 });
  const baked = new THREE.MeshStandardMaterial({ color: colorize ? 0xd7ae6f : 0xa5a39a, roughness: 0.82 });
  const bubble = new THREE.SphereGeometry(0.032, 10, 6);
  const spot = new THREE.SphereGeometry(0.022, 10, 6);
  for (let index = 0; index < 18; index += 1) {
    const [x0, y0] = toppingPoint((index + offset) % 15, 0.82);
    const inHalf = half === 'all' || (half === 'left' ? x0 <= 0 : x0 > 0);
    if (!inHalf) continue;
    const detail = new THREE.Mesh(index % 4 === 0 ? spot : bubble, index % 4 === 0 ? baked : cheese);
    detail.position.set(x0 * 0.96, y0 * 0.96, 0.144 + index % 3 * 0.003);
    detail.scale.set(1.35, 0.8, 0.28);
    group.add(detail);
  }
}

function addHandmadeDetail(group, colorize) {
  const dough = new THREE.MeshStandardMaterial({ color: colorize ? 0xd9ae76 : 0xa9a69d, roughness: 0.92 });
  const toast = new THREE.MeshStandardMaterial({ color: colorize ? 0x9f6d3f : 0x77756e, roughness: 1 });
  const sauce = new THREE.MeshStandardMaterial({ color: colorize ? 0xb95b47 : 0x77756e, roughness: 0.9 });
  const strand = new THREE.CapsuleGeometry(0.012, 0.085, 4, 8);
  for (let index = 0; index < 44; index += 1) {
    const angle = (index / 44) * Math.PI * 2;
    const radius = 1.025 + Math.sin(index * 2.7) * 0.018;
    const bump = new THREE.Mesh(new THREE.SphereGeometry(0.052 + (index % 3) * 0.008, 9, 6), index % 6 === 0 ? toast : dough);
    bump.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.08 + (index % 4) * .006);
    bump.scale.set(1.35, .62, .32);
    bump.rotation.z = angle;
    group.add(bump);
  }
  for (let index = 0; index < 36; index += 1) {
    const angle = index * 2.39996;
    const radius = .18 + (index % 7) * .103;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    const exposed = new THREE.Mesh(new THREE.CircleGeometry(.016 + (index % 4) * .006, 10), index % 5 === 0 ? sauce : toast);
    exposed.position.set(x, y, .128 + (index % 3) * .004);
    group.add(exposed);
    if (index % 2) {
      const cheeseStrand = new THREE.Mesh(strand, dough);
      cheeseStrand.position.set(x * .93, y * .93, .145);
      cheeseStrand.rotation.set(Math.PI / 2, 0, angle + .4);
      cheeseStrand.scale.set(1, .8, .32);
      group.add(cheeseStrand);
    }
  }
}

function makePizzaScene(config = {}) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.scale.setScalar(1.02);
  scene.add(root);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 72),
    new THREE.MeshBasicMaterial({ color: 0x313a33, transparent: true, opacity: 0.1, depthWrite: false })
  );
  shadow.position.set(0, -0.035, -0.27);
  shadow.scale.set(1, 0.72, 1);
  root.add(shadow);

  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(1.16, 72),
    new THREE.MeshStandardMaterial({ color: palette.plate, roughness: 0.92 })
  );
  plate.position.z = -0.22;
  root.add(plate);
  const plateLine = new THREE.Mesh(
    new THREE.TorusGeometry(1.105, 0.018, 7, 72),
    new THREE.MeshBasicMaterial({ color: palette.plateLine, transparent: true, opacity: 0.7 })
  );
  plateLine.position.z = -0.2;
  root.add(plateLine);

  const crustMaterial = new THREE.MeshStandardMaterial({ color: palette.crust, roughness: 0.88 });
  const crust = new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.08, 0.18, 72), crustMaterial);
  crust.rotation.x = Math.PI / 2;
  crust.position.z = -0.045;
  root.add(crust);
  const crustLight = new THREE.Mesh(
    new THREE.TorusGeometry(1.035, 0.045, 9, 72),
    new THREE.MeshStandardMaterial({ color: palette.crustLight, roughness: 0.82 })
  );
  crustLight.position.z = 0.035;
  root.add(crustLight);

  const sauce = new THREE.Mesh(
    new THREE.CircleGeometry(1.005, 72),
    new THREE.MeshStandardMaterial({ color: 0xe4c3a5, roughness: 0.95 })
  );
  sauce.position.z = 0.062;
  root.add(sauce);
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(0.985, 72),
    new THREE.MeshStandardMaterial({ color: palette.cheese, roughness: 0.9 })
  );
  base.position.z = 0.087;
  root.add(base);
  const cheeseEdge = new THREE.Mesh(
    new THREE.TorusGeometry(0.955, 0.018, 6, 72),
    new THREE.MeshStandardMaterial({ color: palette.cheeseShadow, roughness: 0.86 })
  );
  cheeseEdge.position.z = 0.105;
  root.add(cheeseEdge);
  addHandmadeDetail(root, config.mode === 'mitades');

  const halfMeshes = {};
  const focusLights = {};
  const colorHalf = config.mode === 'mitades';
  if (colorHalf) {
    const leftActive = config.activeHalf === 'left';
    const rightActive = config.activeHalf === 'right';
    const left = new THREE.Mesh(halfGeometry(true), new THREE.MeshStandardMaterial({ color: palette.left, emissive: palette.leftInk, emissiveIntensity: leftActive ? 0.18 : 0.02, transparent: true, opacity: leftActive ? 0.61 : 0.23, roughness: 0.9, side: THREE.DoubleSide }));
    const right = new THREE.Mesh(halfGeometry(false), new THREE.MeshStandardMaterial({ color: palette.right, emissive: palette.rightInk, emissiveIntensity: rightActive ? 0.18 : 0.02, transparent: true, opacity: rightActive ? 0.63 : 0.23, roughness: 0.9, side: THREE.DoubleSide }));
    left.position.z = 0.113;
    right.position.z = 0.114;
    left.userData.half = 'left';
    right.userData.half = 'right';
    root.add(left, right);
    halfMeshes.left = left;
    halfMeshes.right = right;
    const leftLight = new THREE.PointLight(palette.leftGlow, leftActive ? 0.5 : 0.06, 2.35);
    leftLight.position.set(-0.48, 0.18, 0.75);
    const rightLight = new THREE.PointLight(palette.rightGlow, rightActive ? 0.5 : 0.06, 2.35);
    rightLight.position.set(0.48, 0.18, 0.75);
    root.add(leftLight, rightLight);
    focusLights.left = leftLight;
    focusLights.right = rightLight;
  }

  addCheeseDetails(root, colorHalf ? 'left' : 'all', colorHalf, 0);
  if (colorHalf) addCheeseDetails(root, 'right', true, 7);
  addToppings(root, colorHalf ? 'left' : 'all', config.leftName || 'Pepperoni', colorHalf, 0);
  if (colorHalf) addToppings(root, 'right', config.rightName || 'Pepperoni', true, 7);

  const divider = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.985, 0.15), new THREE.Vector3(0, 0.985, 0.15)]),
    new THREE.LineBasicMaterial({ color: config.activeHalf === 'right' ? palette.rightInk : palette.leftInk, transparent: true, opacity: colorHalf ? 0.88 : 0 })
  );
  root.add(divider);
  const focusDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.032, 20),
    new THREE.MeshBasicMaterial({ color: config.activeHalf === 'right' ? palette.rightInk : palette.leftInk, transparent: true, opacity: colorHalf ? 0.78 : 0 })
  );
  focusDot.position.set(0, config.activeHalf === 'right' ? 0.72 : -0.72, 0.16);
  root.add(focusDot);
  root.userData.halfMeshes = halfMeshes;
  root.userData.focusLights = focusLights;
  return { scene, root };
}

function makeRenderer(width, height) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const sceneLight = new THREE.HemisphereLight(0xffffff, 0x8f8064, 2.25);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(-1.4, 1.8, 4);
  return { renderer, sceneLight, keyLight };
}

function prepareScene(scene, sceneLight, keyLight) {
  scene.add(sceneLight, keyLight);
  const camera = new THREE.OrthographicCamera(-1.42, 1.42, 1.42, -1.42, 0.1, 12);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function createPizzaThumbnail() {
  const { renderer, sceneLight, keyLight } = makeRenderer(128, 128);
  const { scene } = makePizzaScene({ mode: 'completa', leftName: 'Pepperoni' });
  const camera = prepareScene(scene, sceneLight, keyLight);
  renderer.render(scene, camera);
  const image = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  return image;
}

export function animatePizza(canvas, config) {
  const { renderer, sceneLight, keyLight } = makeRenderer(300, 300);
  const { scene, root } = makePizzaScene(config);
  const camera = prepareScene(scene, sceneLight, keyLight);
  canvas.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', config.mode === 'mitades' ? `Pizza ${config.activeHalf === 'left' ? 'mitad 1' : 'mitad 2'} seleccionada` : 'Pizza completa de pepperoni');
  let frame = 0;
  let animation = 0;
  const resize = new ResizeObserver(entries => {
    const size = Math.max(140, Math.floor(entries[0].contentRect.width));
    renderer.setSize(size, size, false);
  });
  resize.observe(canvas);
  const draw = () => {
    frame += 1;
    root.rotation.z = Math.sin(frame * 0.008) * 0.008;
    root.position.y = Math.sin(frame * 0.014) * 0.006;
    const focus = config.mode === 'mitades' ? root.userData.halfMeshes?.[config.activeHalf] : null;
    if (focus?.material?.opacity !== undefined) {
      const pulse = Math.sin(frame * 0.055);
      focus.material.opacity = 0.59 + pulse * 0.07;
      focus.material.emissiveIntensity = 0.18 + pulse * 0.04;
    }
    const focusLight = config.mode === 'mitades' ? root.userData.focusLights?.[config.activeHalf] : null;
    if (focusLight) focusLight.intensity = 0.48 + Math.sin(frame * 0.045) * 0.065;
    renderer.render(scene, camera);
    animation = requestAnimationFrame(draw);
  };
  draw();
  const dispose = () => {
    cancelAnimationFrame(animation);
    resize.disconnect();
    renderer.dispose();
    activeAnimations.delete(dispose);
  };
  activeAnimations.add(dispose);
  return dispose;
}

export function disposePizzaAnimations() {
  for (const dispose of [...activeAnimations]) dispose();
}
