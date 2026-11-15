import React, { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import type { ViewportShadingConfig, ViewportShadingPresetKey } from '../types/models';
import {
  DEFAULT_SHADING_CONFIG,
  RESIN_PRESETS,
  getGlobalShadingConfig,
  setGlobalShadingConfig,
  subscribeGlobalShading,
} from '../utils/studioResinMaterial';
import { ViewportShadingSpherePreview } from './ViewportShadingSpherePreview';

const PRESET_ORDER: ViewportShadingPresetKey[] = ['clay', 'jade', 'knight', 'ochre', 'wax'];

interface ViewportShadingControlProps {
  onChangeShading?: (cfg: ViewportShadingConfig) => void;
}

/**
 * Mini Configurador Global de Viewport Shading (Esfera em Tempo Real + Cavity Distance/Intensity + Roughness + Specular).
 * Posicionado exclusivamente na entrada do App (Header) e respeitado por todas as abas e views.
 */
export const ViewportShadingControl: React.FC<ViewportShadingControlProps> = ({
  onChangeShading,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [config, setConfig] = useState<ViewportShadingConfig>(() => getGlobalShadingConfig());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeGlobalShading((nextCfg) => {
      setConfig(nextCfg);
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const updateShading = (partial: Partial<ViewportShadingConfig>) => {
    const updated = setGlobalShadingConfig(partial);
    setConfig(updated);
    onChangeShading?.(updated);
  };

  const handleResetDefault = () => {
    const updated = setGlobalShadingConfig(DEFAULT_SHADING_CONFIG);
    setConfig(updated);
    onChangeShading?.(updated);
  };

  const activePreset = RESIN_PRESETS[config.preset] || RESIN_PRESETS.clay;

  return (
    <div ref={containerRef} className="shading-control-wrapper">
      <button
        type="button"
        className="btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        title="Configurar MatCap, Cor, Cavity Distance/Intensity, Roughness e Specular para todo o App"
      >
        <Palette size={18} aria-hidden="true" />
        <span
          className="shading-color-dot"
          data-preset={config.preset}
          aria-hidden="true"
        />
        <span>Shader: {activePreset.label}</span>
      </button>

      {isOpen && (
        <div className="shading-popover" role="dialog" aria-label="Configurador de Viewport Shading">
          <div className="shading-popover-header">
            <span className="shading-popover-title">Viewport Shading (Global)</span>
            <button
              type="button"
              className="shading-reset-btn"
              onClick={handleResetDefault}
              title="Restaurar Cinza Padrão e calibração original"
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>Padrão</span>
            </button>
          </div>

          <ViewportShadingSpherePreview config={config} />

          <div className="shading-section">
            <span className="shading-label">Cor do MatCap (Todas as Abas)</span>
            <div className="shading-swatch-grid">
              {PRESET_ORDER.map((key) => {
                const p = RESIN_PRESETS[key];
                const isSelected = config.preset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className="shading-swatch-btn"
                    data-active={isSelected}
                    onClick={() => updateShading({ preset: key })}
                    title={p.label}
                  >
                    <span
                      className="shading-swatch-circle"
                      data-preset={key}
                      aria-hidden="true"
                    />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="shading-section">
            <div className="shading-slider-row">
              <label htmlFor="sh-cavity-dist" className="shading-label">
                Cavity Distance
              </label>
              <span className="shading-val">{Math.round(config.cavityDistance * 100)}%</span>
            </div>
            <input
              id="sh-cavity-dist"
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={config.cavityDistance}
              onChange={(e) => updateShading({ cavityDistance: parseFloat(e.target.value) })}
              className="shading-range"
            />
          </div>

          <div className="shading-section">
            <div className="shading-slider-row">
              <label htmlFor="sh-cavity-int" className="shading-label">
                Cavity Intensity
              </label>
              <span className="shading-val">{config.cavityIntensity.toFixed(2)}</span>
            </div>
            <input
              id="sh-cavity-int"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.cavityIntensity}
              onChange={(e) => updateShading({ cavityIntensity: parseFloat(e.target.value) })}
              className="shading-range"
            />
          </div>

          <div className="shading-section">
            <div className="shading-slider-row">
              <label htmlFor="sh-roughness" className="shading-label">
                Roughness em Difuso
              </label>
              <span className="shading-val">{Math.round(config.roughness * 100)}%</span>
            </div>
            <input
              id="sh-roughness"
              type="range"
              min={0.1}
              max={1}
              step={0.02}
              value={config.roughness}
              onChange={(e) => updateShading({ roughness: parseFloat(e.target.value) })}
              className="shading-range"
            />
          </div>

          <div className="shading-section">
            <div className="shading-slider-row">
              <label htmlFor="sh-specular" className="shading-label">
                Intensidade Specular (Baixa)
              </label>
              <span className="shading-val">{Math.round(config.specularIntensity * 100)}%</span>
            </div>
            <input
              id="sh-specular"
              type="range"
              min={0}
              max={0.4}
              step={0.01}
              value={config.specularIntensity}
              onChange={(e) => updateShading({ specularIntensity: parseFloat(e.target.value) })}
              className="shading-range"
            />
          </div>
        </div>
      )}
    </div>
  );
};
