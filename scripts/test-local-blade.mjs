import { getWasm } from '../electron/catpin/engine.mjs';
import { norm, frameFromZ } from '../electron/catpin/algebra.mjs';
import { isolateTargetIsland } from '../electron/catpin/islandFilter.mjs';

async function testLocalBlade() {
  const wasm = await getWasm();
  const { Manifold, CrossSection } = wasm;

  console.log('--- TESTE: Modelo Vader com Tronco, Braço Inclinado e Orelha Alta ---');
  // Torso
  const torso = Manifold.cube([30, 40, 50], true); // [-15..15, -20..20, -25..25]
  // Braço cilíndrico saindo do ombro (x=15, y=10, z=15)
  // Criamos o braço como um cilindro cuja base começa no plano da junta
  const arm = Manifold.cylinder(35, 8, 8, 24).rotate([0, 45, 0]).translate([15, 10, 15]);
  // Orelha / chifre alto na cabeça que não deve sofrer nenhum corte
  const head = Manifold.sphere(12, 16).translate([0, 0, 32]);
  const ear = Manifold.cylinder(15, 4, 1, 16).rotate([0, 45, 0]).translate([10, 0, 35]);
  const model = Manifold.union([torso, arm, head, ear]);

  // Centróide na junta do ombro
  const cutPoint = [15, 10, 15];
  const cutNormal = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const basis = frameFromZ(cutNormal, cutPoint);

  // Polyline desenhada ao redor do braço
  const poly = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    poly.push([9.0 * Math.cos(a), 9.0 * Math.sin(a)]);
  }

  const cs = CrossSection.ofPolygons([poly], 'NonZero');
  const hBlade = 0.05;

  // Método: Lâmina Planar seccionadora em Z = 0
  // Testamos progressivamente:
  // 1. Lâmina com contorno da polyline com offsets crescentes (1.5mm, 3mm, 6mm)
  // 2. Lâmina planar local (disco ou caixa com diâmetro 2.5x o contorno, estritamente em Z=0)
  // com espessura fina hBlade = 0.05mm
  let partA = null, partB = null;
  const polySpan = 18; // diâmetro do polyline

  const candidateBlades = [
    cs.offset(1.5, 'Round', 16),
    cs.offset(3.5, 'Round', 16),
    cs.offset(6.0, 'Round', 16),
    // Lâmina planar local circular ou retangular delimitada ao redor da junta (raio = polySpan * 1.5)
    CrossSection.circle(polySpan * 1.5, 32),
  ];

  for (let i = 0; i < candidateBlades.length; i++) {
    const blade2D = candidateBlades[i];
    const worldBlade = Manifold.extrude(blade2D, hBlade, 0, 0, [1, 1], true).transform(basis);
    const comps = model.subtract(worldBlade).decompose().filter(c => Math.abs(c.volume()) >= 0.05);
    console.log(`Lâmina candidato ${i}: ${comps.length} componentes resultantes`);
    if (comps.length >= 2) {
      console.log('SEPAROU COM SUCESSO EM Z = 0!');
      const sorted = [...comps].sort((a, b) => b.volume() - a.volume());
      partA = sorted[0];
      partB = sorted[1];
      break;
    }
  }

  if (partA && partB) {
    console.log('Parte A volume (corpo + orelha):', partA.volume().toFixed(1));
    console.log('Parte B volume (braço isolado):', partB.volume().toFixed(1));
    console.log('Orelha intacta na Parte A? Decompose Parte A:', partA.decompose().length, 'ilha');
    console.log('Braço intacto na Parte B? Decompose Parte B:', partB.decompose().length, 'ilha');
  } else {
    console.log('Nenhum candidato desconectou em Z = 0.');
  }
}

testLocalBlade().catch(console.error);

