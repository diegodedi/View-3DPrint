# Project Rules — Antigravity

> Project Map: read view-3dprint.md at root before any action.

## 🎯 REGRA OBRIGATÓRIA — Módulo de Corte e Conectores (CatPin Standard)
Sempre que for solicitada qualquer alteração, correção ou evolução no módulo de corte de malha (CatPin):
1. Verificar a referência oficial do CatPin (https://blendatlas.com/products/catpin-blender-add-on) e cruzar a especificação com o app.
2. Garantir equivalência funcional 1:1 com o CatPin:
   - **Corte de Membro (Seam / Curve Cut):** O corte deve ser exato com o contorno da seleção, sem artefatos ou caixas oblíquas que decepem partes externas do modelo (como orelhas ou cabeças). A parte separada deve ser exclusivamente o membro isolado, com a peça principal mantendo 100% de integridade (ilhas residuais reanexadas ao corpo).
   - **PROIBIÇÃO ABSOLUTA (Regra CatPin Anti-Cilindro):** É expressamente proibido tentar recriar ou utilizar volume cilíndrico/prismático projetado a partir da polyline desenhada para corte de membro. O corte de membro deve utilizar rigorosamente uma lâmina planar fina seccionadora delimitada pelo contorno da polyline exatamente em Z = 0 (no plano e centróide da seleção), sem nenhum deslocamento em Z (zCut = 0) e sem extrusão frontal/traseira (cilindro projetado), garantindo fidelidade 1:1 ao desenho da polyline e preservando 100% da integridade do restante do modelo.
   - **Posicionamento de Conector:** O pino deve sempre ser posicionado no centróide exato da seção do corte, e o controle de inverter o pino deve rotacionar o pino em 180° com feedback visual imediato na viewport 3D e aplicação correta no motor CSG.
   - **Extrusão de Detalhe (Plug):** Profundidade controlada e rasa para olhos, bocas e adereços.
   - **Corte Plano:** Plano infinito com gizmo 3D para cortes gerais.
3. Testar exaustivamente na bancada automatizada (`npm run test:catpin`) e compilar antes de liberar para o usuário.

## 🔒 REGRA OBRIGATÓRIA — ISOLAMENTO ABSOLUTO E NÃO-CONTAMINAÇÃO DE FERRAMENTAS HOMOLOGADAS (BLINDAGEM DO CATPIN E CORE)
1. **Intocabilidade de Módulos Homologados:** É expressamente proibido alterar, substituir materiais, injetar dependências ou modificar o comportamento visual ou funcional de ferramentas e módulos já homologados e estáveis (em especial todo o ecossistema do CatPin: `CatPinModal.tsx`, `CatPinCanvas.tsx`, `useCatPinModelMesh.ts`, `useCatPinResultMesh.ts`, `useCatPinCutWorkflow.ts`, etc.) para acomodar testes, shaders novos ou recursos experimentais.
2. **Escopo Estritamente Isolado (Sandbox de Novos Recursos):** Qualquer desenvolvimento, shader, efeito visual ou funcionalidade nova deve nascer e operar em escopo 100% isolado (exclusivo do componente solicitante, como `Viewer3D.tsx`), sem alterar funções utilitárias compartilhadas (`threeHelpers.ts`, `matcapUtils.ts`) de modo que force mudanças ou contamine outras ferramentas do sistema.
3. **Imutabilidade do Material do CatPin:** O CatPin deve utilizar única e exclusivamente `createGrayMatcapMaterial()` para a malha principal em modo de edição e o pipeline estável de cores no modo de resultado, sendo terminantemente proibida a injeção de shaders ou materiais novos dentro do CatPin.
4. **Verificação de Regressão Zero:** Antes de qualquer entrega, auditar que nenhum arquivo de ferramentas estáveis foi alterado indevidamente e rodar a bancada completa (`npm run test:catpin`).

## 🛡️ REGRA OBRIGATÓRIA — Estabilidade da Viewport 3D (Three.js & Anti-Black-Screen)
Sempre que for feita qualquer manutenção ou evolução visual no visualizador 3D ou no CatPin:
1. **PROIBIÇÃO ABSOLUTA de Pós-Processamento Invasivo:** É terminantemente proibido utilizar `EffectComposer`, `FullScreenQuad`, `ShaderPass` ou pipelines com render targets secundários de profundidade (`DepthTexture`) para manipular a imagem final da viewport. No Electron, buffers alternados (`ping-pong`) do Three.js não clonam a `depthTexture`, gerando leitura nula no shader e deixando a viewport 100% PRETA.
2. **Renderização Direta Nativa:** Todas as viewports (`Viewer3D.tsx`, `CatPinCanvas.tsx`, `useCatPinScene.ts`) devem renderizar SEMPRE via chamada direta nativa do Three.js: `renderer.render(scene, camera)`.
3. **Padrão de Raio-X CatPin (Imagens 1 e 2):**
   - O modelo 3D permanece 100% sólido e opaco com `createGrayMatcapMaterial()`.
   - O Raio-X é restrito exclusivamente aos elementos de corte:
     - Lâmina de corte seccionadora verde (`0x22c55e`, `opacity: 0.65`, `depthTest: false`, `depthWrite: false`).
     - Contorno da lâmina verde neon (`0x4ade80`, `depthTest: false`, `depthWrite: false`).
     - Conector / pino laranja (`0xff8c00`, `opacity: 0.85`, `depthTest: false`, `depthWrite: false`) e arestas (`0xffe066`).
4. **Proteção de Raycast:** O raycast para posicionamento de pontos da polyline ancoram estritamente na malha principal (`mainMesh`), sem interceptação por elementos internos invisíveis.


