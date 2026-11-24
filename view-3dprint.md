# 🗺️ View 3DPrint — Project Map

## Stack
- Desktop Runtime: Electron (Main + Preload with contextIsolation)
- Frontend: React 18, TypeScript, Vite
- 3D Engine: Three.js (STL / OBJ / 3MF Loaders + OrbitControls + TransformControls + Printability Analyzer)
- 3D Split & Connectors (CatPin): Motor manifold-3d (WASM) em worker thread em `electron/catpin/` (algebra, meshDiagnostics, cutSolids, connectorBuilder, engine), sem Python. Base da vista sempre destra (Z = -viewDir). O cortador na UI é só visual: o motor recebe polígono 2D + base. Diagnóstico de malhas e inversão de lado de pino integrados.
- Slicer Integration: Native Creality Print 7.x / 6.x / 5.x `.3mf` Project & Preset Builder
- Versioning & Updates: GitHub Releases + `electron-updater` (Repo: `diegodedi/View-3DPrint`)
- Styling: Custom CSS Design System (`design-system.css` tokens, no shadows/gradients)

## Folder Structure
electron/
  assets/                → Ícones oficiais do aplicativo e instalador (`icon.png`, `icon.ico`)
  updater.cjs            → Módulo modular de checagem, download e instalação de atualizações automáticas via GitHub Releases
  catpin/
    algebra.mjs            → Álgebra vetorial e matricial 3D/4D pura em ordem coluna-maior
    meshWelder.mjs         → Soldagem bit-a-bit, tolerância espacial e montagem de sólidos Manifold3D
    meshDiagnostics.mjs    → Diagnóstico de integridade, soldagem e validação Manifold3D
    cutSolids.mjs          → Gerador de sólidos Manifold do cortador (plano, extrusão 2D e lâmina planar de membro)
    connectorBuilder.mjs   → Conectores cilíndricos/trapezoidais com tolerâncias e sugestão de pose
    islandFilter.mjs       → Filtro de componentes conexas, isolamento da ilha alvo e preservação do corpo
    engine.mjs             → Orquestrador de jobs, CSG de corte, Seam Blade Severing e minGap
    stlExporter.mjs        → Exportador STL binário 1:1 e extração de métricas de peças Manifold
    worker.mjs             → Worker thread isolada para operações CSG pesadas
    index.cjs              → Pool e ponte IPC Node.js para a worker thread
  launcher.cjs             → Safe cross-platform process spawner for Electron
  localAssetProtocol.cjs   → Custom local-asset:// protocol handler for zero-Base64 cached thumbnails
  exportIpc.cjs            → Handlers IPC de exportação STL (CatPin) e pacotes Multi-Part `.3mf`
  main.cjs                 → Electron main process, window lifecycle, IPC handlers (CatPin cut & suggest)
  preload.cjs              → Secure contextBridge API with small LRU model buffer cache
  scannerCache.cjs         → Persisted directory mtime index cache in userData (v2)
  scannerAsync.cjs         → Concurrent async library folder scanner with mtime cache, O(1) SSD thumb cache & 2KB head read
  scanner.cjs              → Recursive 3D folder scanner, description & centralized metadata/thumbnail saver
  thumbCache.cjs           → Centralized SSD WebP thumbnail cache (userData/thumb-cache) with SHA-1 incremental keys & IPC
  thumb3mfExtractor.cjs    → Zero-dependency ZIP Central Directory extractor for embedded .3mf preview images
  slicerService.cjs        → Auto-detection (Creality Print priority), in-memory preset cache, 1-click spawn
  crealityPresets.cjs      → Reads Creality Print machine/filament/process profiles & merges JSONs
  creality3mfBuilder.cjs   → Builds complete Creality Print `.3mf` packages with smart parameters
  multiPart3mfService.cjs  → Generates standard Multi-Part `.3mf` project packages with arranged plate transforms
  zipWriter.cjs            → Native Node.js zlib/CRC32 `.zip`/`.3mf` archive generator (sync + async)
  webTabsConfig.cjs        → Persistência de URLs, validação e User-Agent das abas web externas (Chat / 3D Generation)
  webTabsService.cjs       → Gerenciador de WebContentsView com sessões persistentes (`persist:ai-chat`, `persist:3d-gen`) e IPC
  hi3d/
    config.cjs             → Configurações persistidas e constantes das wheels Windows/repositórios Hi3D Local
    gpuDetector.cjs        → Detecção de GPU NVIDIA via `nvidia-smi`, VRAM, Compute Capability e espaço em disco
    installer.cjs          → Instalador 1-clique sob demanda (Python 3.10 via `uv` + Hi3Dv1.0 + Hunyuan3D-2 + CUDA 12.4)
    hi3d_worker.py         → Pipeline 1-imagem (`rembg` → `Hunyuan3D-2 mini` → `Hi3D v1.0` → `.stl`/`.obj` em mm)
    runner.cjs             → Executor IPC do worker Hi3D com progresso em tempo real e salvamento na biblioteca
    index.cjs              → Registro dos handlers IPC `hi3d:*` isolados do restante do app
INICIAR_APP.bat            → 1-click desktop launcher for Windows users
src/
  components/
    CatPin/                → CatPinModal, CatPinCanvas, CatPinControls, CatPinConnectorFields, CatPinPartsList, CatPinResultPanel, CatPinOverlay2D, CatPinViewportToolbar, useCatPinMultiParts, useCatPinPlateArrangement, useCatPinCutWorkflow, useCatPinShortcuts, useCatPinCutterLifecycle, useCatPinMirrorLifecycle, useCatPinPointReprojection, useCatPinScene, useCatPinPoints3D, useCatPinGizmoSync, useCatPinResultMesh, useCatPinConnectors, useCatPinModelMesh, useCatPinModelLoader
    WebTabs/               → WebTabWorkspace, WebTabToolbar, AiChatPicker (abas externas integradas Chat e 3D Generation)
    Hi3D/                  → Hi3dWorkspace, Hi3dGpuAlert, Hi3dSetupCard, Hi3dGeneratorCard (aba isolada Hi3D Local 1-imagem)
    ...                    → Header, ViewportShadingControl, ViewportShadingSpherePreview, ObjectGrid, ObjectCard, Viewer3D, useViewer3DScene, DetailsPanel, SlicerModal, SmartSlicePanel, SmartSliceFields, ModelNotesField
  hooks/                   → Custom React hooks (`useLibrary.ts`, `useCatalogItems.ts`, `useSlicerSettings.ts`, `useWebTabs.ts`, `useHi3dLocal.ts`)
  styles/                  → `design-system.css`, `app.css`, `inspector.css`, `catpin.css`, `smart-slicer.css`, `web-tabs.css`, `hi3d.css`, `hi3d-generator.css`
  types/                   → TypeScript interfaces (`models.ts`, `catpin.ts`, `thumbCache.ts`, `catpinMultiParts.ts`, `plateTypes.ts`, `webTabs.ts`, `hi3d.ts`)
  utils/
    plate/                 → autoOrientAntiSupport, plateArranger, geometryDataExtractor, printerBedResolver
    catpin/                → cutSpecBuilder, cutterMeshBuilder, straightCutterBuilder, detailPlugCutterBuilder, mirrorCutUtils, rootGeometryExtractor, cutterSplineHelpers, connectorMeshBuilder, bestFitPlane, deformedSeamMesh
    ...                    → Helpers (`formatters.ts`, `threeHelpers.ts`, `threeMfParser.ts`, `geometryStlEncoder.ts`, `normalSmoother.ts`, `studioResinMaterial.ts`, `matcapUtils.ts`, `thumbnailQueue.ts`, `thumbSessionStore.ts`, `thumbnailRenderer.ts`, `thumbPredecoder.ts`, `meshAnalyzer.ts`, `sliceRecommender.ts`, `meshExtractor.ts`, `meshWorkerClient.ts`, `modelFolderResolver.ts`)
  workers/                 → `meshWorker.ts` (off-thread STL/OBJ/3MF viewer + thumbnail parsing, mesh analysis & deduplication)
sample-library/            → Demo 3D objects folder for immediate testing

## Key Files
src/styles/design-system.css                → All design tokens (colors, typography, spacing, radius)
src/styles/catpin.css                       → CatPin workstation dark UI styles (token-based, zero shadows/gradients)
src/utils/modelFolderResolver.ts            → Identificação e resolução do local/pasta de trabalho do objeto 3D para salvar peças
src/utils/plate/autoOrientAntiSupport.ts    → Cálculo de rotação ideal para assentamento da face de corte plana em Z=0 e anti-suporte
src/utils/plate/plateArranger.ts            → Algoritmo de empacotamento 2D (Shelf Nesting) de peças com margem de segurança na mesa
src/utils/plate/printerBedResolver.ts       → Resolução automática das dimensões úteis da mesa (X, Y, Z) da impressora configurada
electron/multiPart3mfService.cjs            → Gerador nativo de pacotes .3mf multi-itens orientados para fatiamento em 1 clique
src/components/useViewer3DScene.ts           → Hook modular que isola o ciclo de vida Three.js (Scene, Camera, Renderer) da interface React do Viewer3D
src/components/CatPin/CatPinModal.tsx       → CatPin Draft-to-Commit orchestrator (Carregamento de malha 100% autônomo e isolado do disco)
src/components/CatPin/useCatPinMultiParts.ts→ Gerenciador de árvore de peças, seleção individual, Undo/Redo e exportação STL
src/components/CatPin/useCatPinPlateArrangement.ts → Hook modular de orientação anti-suporte, nesting na mesa e exportação 3MF
src/components/CatPin/CatPinPartsList.tsx   → Lista interativa de peças resultantes para novos cortes sucessivos
src/components/CatPin/CatPinCanvas.tsx      → Three.js Draft Viewport (Destra Z=-viewDir, Gizmo W/E, locked Pin pose)
src/components/CatPin/useCatPinResultMesh.ts→ Result Mode multi-part renderer aligned to rootTransform + Explode View + Plate Nesting Mode
src/components/ViewportShadingControl.tsx   → Mini configurador global de Viewport Shading (Cor, Cavity Distance, Cavity Intensity, Roughness, Specular) posicionado na viewport de visualização do objeto solo (Viewer3D)
src/components/ViewportShadingSpherePreview.tsx → Esfera 3D esculpida de pré-visualização em tempo real dos modificadores de Viewport Shading
src/utils/normalSmoother.ts                 → Suavizador de normais com Crease Angle in-place (sem alterar vértices/índices) para Cavity perfeito em STL
src/utils/studioResinMaterial.ts            → Shader global unificado (MatCap Cinza Padrão + Cavity + Roughness Difuso + Baixa Specular) para todas as abas e peças
src/utils/catpin/bestFitPlane.ts            → Ajuste de plano por vetor Normal de Newell (Stokes) com base destra
src/utils/catpin/deformedSeamMesh.ts        → Malha 3D deformada (Catmull-Rom 3D + superfície harmônica w(u,v)) fiel à Polyline
src/utils/catpin/cutSpecBuilder.ts          → Única ponte entre UI e Motor: converte cortador (UV + W) e pino para espaço do modelo
src/utils/catpin/cutterMeshBuilder.ts       → Cortador visual UI (Lasso Cut, Split Line, Plane Cut, Seam Cut deformado 3D)
src/utils/catpin/cutterSplineHelpers.ts     → LockedViewBasis destro, contorno 3D perimetral e fechamento 2D
src/utils/catpin/connectorMeshBuilder.ts    → 64-seg In-place Pin/Socket geometry updater
src/utils/catpin/mirrorCutUtils.ts          → Detecção de simetria X (Spatial Hash 3D), espelhamento de pontos/normais e proteção de corte central
src/components/CatPin/useCatPinMirrorLifecycle.ts → Ciclo de vida 3D isolado do cortador e pino espelhados (Mirror Cut) na Viewport
electron/catpin/cutSolids.mjs               → Lâmina Seccionadora Pura em Z=0 (Subtração + Decomposição CSG Manifold3D sem volumes ou cilindros)
electron/catpin/engine.mjs                  → Motor CSG puro manifold-3d (WASM) com tolerância, folga e auto-sugestão
scripts/prototype-partition.mjs             → Protótipo geométrico isolado de Partição por Primeira Casca (Shell 1)

## Regra de Blindagem e Isolamento de Módulos Homologados (Mandatória)
- Intocabilidade de Módulos Homologados: É expressamente proibido alterar, substituir materiais ou injetar modificações em ferramentas homologadas (CatPin, Slicer, etc.) para aplicar testes ou novos recursos visuais.
- Isolamento Total: Qualquer novo shader ou recurso visual deve residir exclusivamente no seu próprio escopo (ex: Viewer3D), sem alterar o comportamento padrão de `createGrayMatcapMaterial()` ou de helpers compartilhados que afetem o CatPin.
- CatPin 100% Protegido: O CatPin utiliza única e exclusivamente `createGrayMatcapMaterial()` e seu pipeline original de cores de peças, sem qualquer contaminação externa.

## Regra do Módulo CatPin (Mandatória)
Sempre que for solicitada qualquer alteração no corte de malha, verificar a referência oficial do CatPin (https://blendatlas.com/products/catpin-blender-add-on) e cruzar a especificação com o app:
- Corte de Membro (Seam): Lâmina Planar Fina seccionadora delimitada estritamente à junta circulada pela Polyline em Z = 0 (Stokes / Normal de Newell analítica pura), preservando 100% das extremidades e o corpo principal.
- PROIBIÇÃO ABSOLUTA (Regra Anti-Cilindro): É expressamente proibido tentar recriar ou utilizar volume cilíndrico/prismático projetado a partir da polyline para corte de membro. O corte deve ocorrer rigorosamente na junta (zCut = 0) sem nenhum deslocamento em Z e sem extrusão frontal/traseira (cilindro projetado).
- Cortes Sucessivos Multi-Peças: suporte ilimitado a `Cortar → Separar → Selecionar peça → Cortar novamente`, preservando origem 3D, histórico Undo/Redo (`Ctrl+Z`/`Ctrl+Y`) e exportação individual ou em lote.
- Conectores: exclusivos da ferramenta de Corte de Membro (Seam); as ferramentas de Extrusão de Detalhe e Corte Plano operam sem conectores por especificação. Pino no centróide exato da seleção e inversão de 180° com rotação imediata na viewport 3D.
- Testes: executar bancada estendida (`npm run test:catpin`) e build (`npm run build:vite`) antes de liberar para o usuário.

## Last updated: 2026-11-24 (Refatoração de limpeza: extração exportIpc.cjs e catpin.ts, remoção de código morto e 0 violações no audit_inspector)
