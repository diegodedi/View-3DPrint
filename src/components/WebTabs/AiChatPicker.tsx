import React, { useState } from 'react';
import { MessageSquare, Globe, ArrowRight } from 'lucide-react';
import { AI_CHAT_PRESETS } from '../../types/webTabs';

interface AiChatPickerProps {
  onSelectUrl: (url: string) => Promise<boolean>;
  errorMessage: string | null;
}

/**
 * First-time / switch-provider picker for the Chat tab (ChatGPT, Claude, Gemini, etc. or custom URL).
 */
export const AiChatPicker: React.FC<AiChatPickerProps> = ({ onSelectUrl, errorMessage }) => {
  const [customUrl, setCustomUrl] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleChoose = async (url: string) => {
    setIsSubmitting(true);
    await onSelectUrl(url);
    setIsSubmitting(false);
  };

  const handleSubmitCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    await handleChoose(customUrl);
  };

  return (
    <section className="webtab-picker" aria-label="Escolher IA para o Chat">
      <div className="webtab-picker-card">
        <div className="webtab-picker-header">
          <MessageSquare size={28} color="var(--color-primary)" aria-hidden="true" />
          <div>
            <h2 className="webtab-picker-title">Escolha sua IA preferida</h2>
            <p className="webtab-picker-subtitle">
              Faça login uma vez e ela ficará salva como padrão sempre que você abrir a aba Chat.
            </p>
          </div>
        </div>

        <div className="webtab-preset-grid">
          {AI_CHAT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="webtab-preset-btn"
              disabled={isSubmitting}
              onClick={() => handleChoose(preset.url)}
            >
              <span className="webtab-preset-name">{preset.name}</span>
              <span className="webtab-preset-desc">{preset.description}</span>
            </button>
          ))}
        </div>

        <form className="webtab-custom-form" onSubmit={handleSubmitCustom}>
          <label className="webtab-custom-label" htmlFor="custom-ai-url">
            Ou informe outro endereço de IA
          </label>
          <div className="webtab-custom-row">
            <Globe size={18} className="webtab-custom-icon" aria-hidden="true" />
            <input
              id="custom-ai-url"
              type="text"
              className="webtab-url-input"
              placeholder="https://..."
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              disabled={isSubmitting}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !customUrl.trim()}
            >
              <span>Abrir</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </form>

        {errorMessage && (
          <p className="webtab-error-inline" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </section>
  );
};
