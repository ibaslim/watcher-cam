// A small ⓘ icon that reveals a plain-language explanation on hover or focus.
// Keeps the settings forms self-explanatory without cluttering them with text.
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      className="infotip"
      tabIndex={0}
      role="note"
      aria-label={text}
    >
      <span className="infotip-ic" aria-hidden>i</span>
      <span className="infotip-bubble">{text}</span>
    </span>
  );
}
