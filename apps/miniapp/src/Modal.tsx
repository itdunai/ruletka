import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  title: string;
  message: string;
  onClose: () => void;
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  background: "rgba(0, 0, 0, 0.78)",
  backdropFilter: "blur(3px)",
  WebkitBackdropFilter: "blur(3px)"
};

const cardStyle: CSSProperties = {
  position: "relative",
  width: "min(100%, 360px)",
  maxHeight: "min(80vh, 520px)",
  overflow: "auto",
  padding: "24px 20px 20px",
  borderRadius: 20,
  border: "1px solid rgba(191, 255, 0, 0.45)",
  background: "linear-gradient(180deg, #2a3024 0%, #1a1c18 100%)",
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.55)"
};

export function Modal({ title, message, onClose }: ModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div className="modalOverlay" style={overlayStyle} role="presentation" onClick={onClose}>
      <div
        className="modalCard"
        style={cardStyle}
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
    </div>,
    document.body
  );
}
