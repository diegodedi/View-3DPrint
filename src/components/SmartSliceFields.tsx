import React from 'react';
import type { BrimMode, InfillPattern, SmartSliceConfig, SupportMode } from '../types/models';

interface SmartSliceFieldsProps {
  sliceConfig: SmartSliceConfig;
  onUpdateSliceConfig: (patch: Partial<SmartSliceConfig>) => void;
}

const SPEED_OPTIONS = [45, 60, 85, 110, 125, 145, 165, 180, 200, 220];

/**
 * Editable Creality Print parameter controls (layer height, walls, infill, support, brim, speed).
 */
export const SmartSliceFields: React.FC<SmartSliceFieldsProps> = ({
  sliceConfig,
  onUpdateSliceConfig,
}) => {
  return (
    <div className="smart-grid-fields">
      <div className="smart-field">
        <label htmlFor="cfg-layer" className="smart-label">
          Altura de Camada
        </label>
        <select
          id="cfg-layer"
          className="smart-select"
          value={sliceConfig.layerHeight}
          onChange={(e) => onUpdateSliceConfig({ layerHeight: Number(e.target.value) })}
        >
          {[0.12, 0.16, 0.2, 0.24, 0.28].map((h) => (
            <option key={h} value={h}>
              {h.toFixed(2)} mm
            </option>
          ))}
        </select>
      </div>

      <div className="smart-field">
        <label htmlFor="cfg-walls" className="smart-label">
          Paredes (Loops)
        </label>
        <select
          id="cfg-walls"
          className="smart-select"
          value={sliceConfig.wallLoops}
          onChange={(e) => onUpdateSliceConfig({ wallLoops: Number(e.target.value) })}
        >
          {[2, 3, 4, 5].map((w) => (
            <option key={w} value={w}>
              {w} paredes
            </option>
          ))}
        </select>
      </div>

      <div className="smart-field">
        <label htmlFor="cfg-infill" className="smart-label">
          Preenchimento
        </label>
        <select
          id="cfg-infill"
          className="smart-select"
          value={sliceConfig.infillDensity}
          onChange={(e) => onUpdateSliceConfig({ infillDensity: Number(e.target.value) })}
        >
          {[10, 15, 20, 25, 35, 50].map((d) => (
            <option key={d} value={d}>
              {d}%
            </option>
          ))}
        </select>
      </div>

      <div className="smart-field">
        <label htmlFor="cfg-pattern" className="smart-label">
          Padrão Infill
        </label>
        <select
          id="cfg-pattern"
          className="smart-select"
          value={sliceConfig.infillPattern}
          onChange={(e) => onUpdateSliceConfig({ infillPattern: e.target.value as InfillPattern })}
        >
          <option value="gyroid">Gyroid</option>
          <option value="grid">Grid</option>
          <option value="crosshatch">Crosshatch</option>
        </select>
      </div>

      <div className="smart-field">
        <label htmlFor="cfg-support" className="smart-label">
          Suporte
        </label>
        <select
          id="cfg-support"
          className="smart-select"
          value={sliceConfig.supportMode}
          onChange={(e) => onUpdateSliceConfig({ supportMode: e.target.value as SupportMode })}
        >
          <option value="none">Desativado</option>
          <option value="tree">Árvore Auto</option>
          <option value="normal">Normal Auto</option>
        </select>
      </div>

      <div className="smart-field">
        <label htmlFor="cfg-brim" className="smart-label">
          Aderência (Brim)
        </label>
        <select
          id="cfg-brim"
          className="smart-select"
          value={sliceConfig.brimMode}
          onChange={(e) =>
            onUpdateSliceConfig({
              brimMode: e.target.value as BrimMode,
              brimWidthMm: e.target.value === 'no_brim' ? 0 : Math.max(sliceConfig.brimWidthMm, 5),
            })
          }
        >
          <option value="no_brim">Sem Brim</option>
          <option value="auto_brim">Brim Auto</option>
          <option value="outer_only">Brim Externo ({Math.max(sliceConfig.brimWidthMm, 5)}mm)</option>
        </select>
      </div>

      <div className="smart-field smart-field-full">
        <label htmlFor="cfg-speed" className="smart-label">
          Velocidade Parede Externa / Interna
        </label>
        <select
          id="cfg-speed"
          className="smart-select"
          value={sliceConfig.outerWallSpeed}
          onChange={(e) => {
            const outer = Number(e.target.value);
            onUpdateSliceConfig({
              outerWallSpeed: outer,
              innerWallSpeed: Math.round(outer * 1.45),
              infillSpeed: Math.round(outer * 1.5),
            });
          }}
        >
          {SPEED_OPTIONS.map((spd) => (
            <option key={spd} value={spd}>
              {spd} mm/s (Interna {Math.round(spd * 1.45)} mm/s)
            </option>
          ))}
          {!SPEED_OPTIONS.includes(sliceConfig.outerWallSpeed) && (
            <option value={sliceConfig.outerWallSpeed}>
              {sliceConfig.outerWallSpeed} mm/s (Interna {sliceConfig.innerWallSpeed} mm/s)
            </option>
          )}
        </select>
      </div>
    </div>
  );
};

