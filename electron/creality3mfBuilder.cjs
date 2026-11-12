const fs = require('fs');
const path = require('path');
const { createZipBuffer } = require('./zipWriter.cjs');
const { buildCrealityProjectConfigs } = require('./crealityPresets.cjs');

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mapSliceConfigToCrealityKeys(cfg) {
  const enableSupport = cfg.supportMode !== 'none' ? '1' : '0';
  const supportType = cfg.supportMode === 'tree' ? 'tree(auto)' : 'normal(auto)';
  return {
    layer_height: String(cfg.layerHeight),
    initial_layer_print_height: '0.2',
    wall_loops: String(cfg.wallLoops),
    top_shell_layers: String(cfg.topShellLayers),
    bottom_shell_layers: String(cfg.bottomShellLayers),
    sparse_infill_density: `${cfg.infillDensity}%`,
    sparse_infill_pattern: String(cfg.infillPattern),
    enable_support: enableSupport,
    support_type: supportType,
    support_threshold_angle: '30',
    support_on_build_plate_only: cfg.supportOnBuildPlateOnly ? '1' : '0',
    brim_type: String(cfg.brimMode),
    brim_width: String(cfg.brimWidthMm),
    outer_wall_speed: String(cfg.outerWallSpeed),
    inner_wall_speed: String(cfg.innerWallSpeed),
    sparse_infill_speed: String(cfg.infillSpeed),
    top_surface_speed: String(cfg.topSurfaceSpeed),
    initial_layer_speed: String(cfg.initialLayerSpeed),
    speed_limit_to_height_enable: cfg.heightSpeedLimit ? '1' : '0',
    detect_overhang_wall: '1',
    enable_overhang_speed: '1',
  };
}

function buildContentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    ' <Default Extension="png" ContentType="image/png"/>',
    ' <Default Extension="gcode" ContentType="text/x.gcode"/>',
    '</Types>',
  ].join('\n');
}

function buildRootRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
  ].join('\n');
}

function buildModelRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
  ].join('\n');
}

function buildObjectMeshXml(vertices, indices) {
  const vLines = [];
  for (let i = 0; i < vertices.length; i += 3) {
    vLines.push(
      `     <vertex x="${vertices[i].toFixed(5)}" y="${vertices[i + 1].toFixed(5)}" z="${vertices[i + 2].toFixed(5)}"/>`
    );
  }
  const tLines = [];
  for (let i = 0; i < indices.length; i += 3) {
    tLines.push(`     <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ' <resources>',
    '  <object id="1" p:UUID="00020000-81cb-4c03-9d28-80fed5dfa1dc" type="model">',
    '   <mesh>',
    '    <vertices>',
    vLines.join('\n'),
    '    </vertices>',
    '    <triangles>',
    tLines.join('\n'),
    '    </triangles>',
    '   </mesh>',
    '  </object>',
    ' </resources>',
    ' <build/>',
    '</model>',
  ].join('\n');
}

function buildSceneModelXml(options) {
  const { title, bedCenterX, bedCenterY, halfHeightZ } = options;
  const dateStr = new Date().toISOString().slice(0, 10);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">',
    ' <metadata name="Application">Creality_Print V7.2.0</metadata>',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ` <metadata name="CreationDate">${dateStr}</metadata>`,
    ` <metadata name="ModificationDate">${dateStr}</metadata>`,
    ` <metadata name="Title">${escapeXml(title)}</metadata>`,
    ' <resources>',
    '  <object id="2" p:UUID="00000002-61cb-4c03-9d28-80fed5dfa1dc" type="model">',
    '   <components>',
    '    <component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="00020000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>',
    '   </components>',
    '  </object>',
    ' </resources>',
    ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">',
    `  <item objectid="2" p:UUID="00000002-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 ${bedCenterX} ${bedCenterY} ${halfHeightZ.toFixed(5)}" printable="1"/>`,
    ' </build>',
    '</model>',
  ].join('\n');
}

function buildModelSettingsXml(options) {
  const { modelName, sourcePath, halfHeightZ, overrides } = options;
  const safeName = escapeXml(modelName);
  const metaTags = Object.entries(overrides)
    .map(([k, v]) => `    <metadata key="${escapeXml(k)}" value="${escapeXml(v)}"/>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    '  <object id="2">',
    `    <metadata key="name" value="${safeName}"/>`,
    '    <metadata key="extruder" value="1"/>',
    metaTags,
    '    <part id="1" subtype="normal_part">',
    `      <metadata key="name" value="${safeName}"/>`,
    '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>',
    `      <metadata key="source_file" value="${escapeXml(sourcePath)}"/>`,
    '      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>',
    '    </part>',
    '  </object>',
    '  <plate>',
    '    <metadata key="plater_id" value="1"/>',
    '    <metadata key="plater_name" value=""/>',
    '    <metadata key="locked" value="false"/>',
    '    <model_instance>',
    '      <metadata key="object_id" value="2"/>',
    '      <metadata key="instance_id" value="0"/>',
    '      <metadata key="identify_id" value="101"/>',
    '    </model_instance>',
    '  </plate>',
    '  <assemble>',
    `    <assemble_item object_id="2" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 ${halfHeightZ.toFixed(5)}" offset="0 0 0"/>`,
    '  </assemble>',
    '</config>',
  ].join('\n');
}

function buildCrealityHeaderXmls() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const crealityXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    '  <metadata key="Company" value="Creality"/>',
    '  <metadata key="Application" value="Creality_Print"/>',
    '  <metadata key="AppVersion" value="7.2.0"/>',
    '  <metadata key="FileVersion" value="1.0"/>',
    `  <metadata key="CreationDate" value="${dateStr}"/>`,
    '</config>',
  ].join('\n');

  const sliceInfoXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    '  <header>',
    '    <header_item key="X-CX-Client-Type" value="creality_print"/>',
    '    <header_item key="X-CX-Client-Version" value="7.2.0"/>',
    '  </header>',
    '</config>',
  ].join('\n');
  return { crealityXml, sliceInfoXml };
}

/**
 * Generates a configured .3mf project file ready to open in Creality Print / OrcaSlicer / Bambu Studio.
 * @param {object} params
 */
function generateConfigured3mfPackage(params) {
  const { tempDir, modelPath, meshPayload, sliceConfig, slicerExePath, printerName, filamentName } = params;
  const overrides = mapSliceConfigToCrealityKeys(sliceConfig);
  const { bedCenterX, bedCenterY, configs } = buildCrealityProjectConfigs({
    slicerExePath,
    printerName,
    filamentName,
    processOverrides: overrides,
  });

  const baseName = path.basename(modelPath, path.extname(modelPath));
  const safeFileBase = baseName.replace(/[<>:"/\\|?*]+/g, '_');
  const halfHeightZ = Math.max(0, Number(meshPayload.heightMm || 0) / 2);
  const vertices = new Float32Array(meshPayload.vertices);
  const indices = new Uint32Array(meshPayload.indices);
  const { crealityXml, sliceInfoXml } = buildCrealityHeaderXmls();

  const zipEntries = [
    { path: '[Content_Types].xml', content: buildContentTypesXml() },
    { path: '_rels/.rels', content: buildRootRelsXml() },
    { path: '3D/_rels/3dmodel.model.rels', content: buildModelRelsXml() },
    { path: '3D/Objects/object_1.model', content: buildObjectMeshXml(vertices, indices) },
    {
      path: '3D/3dmodel.model',
      content: buildSceneModelXml({ title: baseName, bedCenterX, bedCenterY, halfHeightZ }),
    },
    {
      path: 'Metadata/model_settings.config',
      content: buildModelSettingsXml({ modelName: baseName, sourcePath: modelPath, halfHeightZ, overrides }),
    },
    { path: 'Metadata/slice_info.config', content: sliceInfoXml },
    { path: 'Metadata/creality.config', content: crealityXml },
  ];

  if (configs) {
    zipEntries.push(
      { path: 'Metadata/project_settings.config', content: JSON.stringify(configs.project, null, 2) },
      { path: 'Metadata/process_settings_1.config', content: JSON.stringify(configs.process, null, 2) },
      { path: 'Metadata/machine_settings_1.config', content: JSON.stringify(configs.machine, null, 2) },
      { path: 'Metadata/filament_settings_1.config', content: JSON.stringify(configs.filament, null, 2) }
    );
  }

  fs.mkdirSync(tempDir, { recursive: true });
  const output3mfPath = path.join(tempDir, `${safeFileBase}_CrealityAuto.3mf`);
  fs.writeFileSync(output3mfPath, createZipBuffer(zipEntries));
  return { output3mfPath, hasFullProjectProfile: Boolean(configs) };
}

module.exports = { generateConfigured3mfPackage };

