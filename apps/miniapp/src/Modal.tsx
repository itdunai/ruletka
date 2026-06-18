type ModalProps = {
  title: string;
  message: string;
  onClose: () => void;
};

export function Modal({ title, message, onClose }: ModalProps) {
  return (
    <div className="modalOverlay" role="presentation" onClick={onClose}>
      <div
        className="modalCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="modalClose" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h2 id="app-modal-title" className="modalTitle">
          {title}
        </h2>
        <div className="modalBody">
          {message.split("\n").map((line, index) =>
            line.trim() ? (
              <p key={`${index}-${line.slice(0, 12)}`}>{line}</p>
            ) : (
              <br key={`gap-${index}`} />
            )
          )}
        </div>
        <button type="button" className="modalBtn" onClick={onClose}>
          Понятно
        </button>
      </div>
    </div>
  );
}
