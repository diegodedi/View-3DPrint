const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'release'].includes(file)) {
        results = results.concat(walk(fullPath));
      }
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

const allFiles = walk('src').concat(walk('electron')).concat(walk('scripts'));
const codeFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx|mjs|cjs|css|html)$/.test(f));

const report = {
  summary: {},
  filesOver300Lines: [],
  files151To300Lines: [],
  consoleLogs: [],
  debuggers: [],
  todosWithoutTickets: [],
  cssBoxShadows: [],
  cssGradients: [],
  inlineStylesInJsx: [],
  hardcodedHexColorsInSrc: [],
  functionsWithAndInName: [],
  functionsWithMoreThan3Params: [],
  divWithOnClickInsteadOfButton: [],
  imgMissingAlt: [],
  headingLevelViolations: [],
  electronSecurityAudit: {},
  catpinRuleAudit: {},
  viewportStabilityAudit: {}
};

codeFiles.forEach(filePath => {
  const normalized = filePath.replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const lineCount = lines.length;
  const isTestOrScript = normalized.startsWith('scripts/');

  const hasExemptionComment = /ISENÇÃO|Exempt|File exemption/i.test(lines.slice(0, 10).join('\n'));

  if (lineCount > 300) {
    if (!hasExemptionComment) {
      report.filesOver300Lines.push({ file: normalized, lines: lineCount });
    }
  } else if (lineCount > 150) {
    report.files151To300Lines.push({ file: normalized, lines: lineCount });
  }

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();

    // console.log
    if (lineText.includes('console.log') && !isTestOrScript) {
      report.consoleLogs.push({ file: normalized, line: lineNum, text: trimmed });
    }

    // debugger
    if (/\bdebugger\b/.test(lineText) && !isTestOrScript) {
      report.debuggers.push({ file: normalized, line: lineNum, text: trimmed });
    }

    // TODO
    if (lineText.includes('TODO') && !isTestOrScript) {
      const hasTicket = /TODO\s*[\(\[]?[A-Z0-9]+-?[0-9]+/i.test(lineText);
      if (!hasTicket) {
        report.todosWithoutTickets.push({ file: normalized, line: lineNum, text: trimmed });
      }
    }

    // Inline style in TSX/JSX
    if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx')) {
      if (/style=\{\{/.test(lineText)) {
        report.inlineStylesInJsx.push({ file: normalized, line: lineNum, text: trimmed });
      }
      // div with onClick
      if (/<div[^>]*onClick/i.test(lineText)) {
        report.divWithOnClickInsteadOfButton.push({ file: normalized, line: lineNum, text: trimmed });
      }
    }

    // Hardcoded hex colors in src/components or src/styles
    if (normalized.startsWith('src/') && (normalized.endsWith('.tsx') || normalized.endsWith('.ts') || normalized.endsWith('.css'))) {
      // Ignore design-system.css and WebGL constant color mappings
      if (!normalized.includes('design-system.css') && !normalized.includes('catpinMultiParts.ts')) {
        const hexMatch = lineText.match(/#[0-9a-fA-F]{3,8}\b/g);
        if (hexMatch) {
          // exclude comments
          if (!trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
            report.hardcodedHexColorsInSrc.push({ file: normalized, line: lineNum, hex: hexMatch, text: trimmed });
          }
        }
      }
    }

    // CSS checks
    if (normalized.endsWith('.css') && !normalized.includes('design-system.css')) {
      if (lineText.includes('box-shadow:') && !lineText.includes('none')) {
        report.cssBoxShadows.push({ file: normalized, line: lineNum, text: trimmed });
      }
      if (/linear-gradient|radial-gradient|conic-gradient/.test(lineText)) {
        report.cssGradients.push({ file: normalized, line: lineNum, text: trimmed });
      }
    }

    // Functions with "And" in name
    const andMatch = lineText.match(/(?:function\s+([A-Za-z0-9_]*[a-z]And[A-Z][A-Za-z0-9_]*)|const\s+([A-Za-z0-9_]*[a-z]And[A-Z][A-Za-z0-9_]*)\s*=\s*(?:function|\([^)]*\)\s*=>|\w+\s*=>))/);
    if (andMatch) {
      const fnName = andMatch[1] || andMatch[2];
      report.functionsWithAndInName.push({ file: normalized, line: lineNum, name: fnName, text: trimmed });
    }

    // Functions with > 3 params (regular function signature line)
    const fnDef = lineText.match(/function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
    if (fnDef) {
      const params = fnDef[2].split(',').map(p => p.trim()).filter(Boolean);
      if (params.length > 3) {
        report.functionsWithMoreThan3Params.push({ file: normalized, line: lineNum, name: fnDef[1], paramCount: params.length });
      }
    }
  });
});

// Specific Electron Security Audit
const mainCjsPath = 'electron/main.cjs';
if (fs.existsSync(mainCjsPath)) {
  const mainCjs = fs.readFileSync(mainCjsPath, 'utf8');
  report.electronSecurityAudit = {
    contextIsolation: /contextIsolation:\s*true/.test(mainCjs),
    nodeIntegrationFalse: /nodeIntegration:\s*false/.test(mainCjs),
    sandboxEnabled: /sandbox:\s*true/.test(mainCjs),
    webSecurityTrue: !/webSecurity:\s*false/.test(mainCjs),
    allowRunningInsecureContent: /allowRunningInsecureContent:\s*true/.test(mainCjs),
  };
}

// CatPin Material & Isolation Audit
const matcapUtils = fs.readFileSync('src/utils/matcapUtils.ts', 'utf8');
report.catpinRuleAudit = {
  createGrayMatcapUsesStudioResin: /createStudioResinMaterial/.test(matcapUtils),
  createGrayMatcapUsesMeshMatcap: /MeshMatcapMaterial/.test(matcapUtils),
};

// Viewport 3D Stability Audit (Direct Render vs EffectComposer)
const viewer3D = fs.readFileSync('src/components/Viewer3D.tsx', 'utf8');
const viewer3DScene = fs.existsSync('src/components/useViewer3DScene.ts') ? fs.readFileSync('src/components/useViewer3DScene.ts', 'utf8') : '';
const catPinCanvas = fs.readFileSync('src/components/CatPin/CatPinCanvas.tsx', 'utf8');
const catPinScene = fs.readFileSync('src/components/CatPin/useCatPinScene.ts', 'utf8');

report.viewportStabilityAudit = {
  viewer3DHasEffectComposer: /EffectComposer/.test(viewer3D) || /EffectComposer/.test(viewer3DScene),
  viewer3DDirectRender: /render\(sceneRef\.current,\s*cameraRef\.current\)/.test(viewer3D) || /render\(sceneRef\.current,\s*cameraRef\.current\)/.test(viewer3DScene),
  catPinCanvasHasEffectComposer: /EffectComposer/.test(catPinCanvas),
  catPinCanvasDirectRender: /renderer\.render\(/.test(catPinCanvas) || /renderScene/.test(catPinCanvas),
  catPinSceneHasEffectComposer: /EffectComposer/.test(catPinScene),
};

report.summary = {
  totalFilesOver300Lines: report.filesOver300Lines.length,
  totalFiles151To300Lines: report.files151To300Lines.length,
  totalConsoleLogs: report.consoleLogs.length,
  totalDebuggers: report.debuggers.length,
  totalTodosWithoutTickets: report.todosWithoutTickets.length,
  totalCssBoxShadows: report.cssBoxShadows.length,
  totalCssGradients: report.cssGradients.length,
  totalInlineStylesInJsx: report.inlineStylesInJsx.length,
  totalHardcodedHexInSrc: report.hardcodedHexColorsInSrc.length,
  totalFunctionsWithAnd: report.functionsWithAndInName.length,
  totalFunctionsMoreThan3Params: report.functionsWithMoreThan3Params.length,
  totalDivWithOnClick: report.divWithOnClickInsteadOfButton.length,
  totalImgMissingAlt: report.imgMissingAlt.length
};

fs.writeFileSync('audit_out.json', JSON.stringify(report, null, 2), 'utf8');
console.log('Audit completed successfully. Summary:', JSON.stringify(report.summary, null, 2));
