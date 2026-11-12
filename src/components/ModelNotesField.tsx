import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

interface ModelNotesFieldProps {
  initialNotes: string;
  folderPath: string;
  onSaveNotes: (folderPath: string, notes: string) => void;
}

const MAX_NOTES_LENGTH = 500;

/**
 * Self-contained printing notes field with character validation and auto-save on blur.
 */
export const ModelNotesField: React.FC<ModelNotesFieldProps> = ({
  initialNotes,
  folderPath,
  onSaveNotes,
}) => {
  const [notesDraft, setNotesDraft] = useState<string>(initialNotes);
  const [notesError, setNotesError] = useState<string | null>(null);

  useEffect(() => {
    setNotesDraft(initialNotes);
    setNotesError(null);
  }, [initialNotes, folderPath]);

  const handleBlur = () => {
    if (notesDraft.length > MAX_NOTES_LENGTH) {
      setNotesError(`A anotação deve ter no máximo ${MAX_NOTES_LENGTH} caracteres.`);
      return;
    }
    setNotesError(null);
    if (notesDraft !== initialNotes) {
      onSaveNotes(folderPath, notesDraft);
    }
  };

  return (
    <div className="smart-field">
      <label htmlFor="print-notes-input" className="smart-label">
        <Save size={12} aria-hidden="true" /> NOTAS DE IMPRESSÃO:
      </label>
      <textarea
        id="print-notes-input"
        rows={2}
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder="Ex: PLA 210°C, bico 0.4mm, observações pessoais..."
        className="smart-select"
      />
      {notesError && (
        <span className="field-error-text">
          {notesError}
        </span>
      )}
    </div>
  );
};

